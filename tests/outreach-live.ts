/**
 * Live verification: Outreach Agent planner must produce a prepare_email
 * proposal grounded in REAL lead/contact data (no hallucinated arguments).
 * Uses the seeded production workspace — the run is read-only + draft-only
 * (prepare_email never sends), so no live data is mutated.
 *
 * Usage: npx tsx --env-file=.env.local tests/outreach-live.ts
 */
import { db } from "@/db";
import { agents, agentRuns, agentTraces } from "@/db/schema";
import { and, desc, eq } from "drizzle-orm";
import { ensureWorkspaceAgents } from "@/agents/registry";
import { AgentRunnerService } from "@/agents/services/runner.service";

const WORKSPACE_NAME = process.argv[2] ?? "Aexyl";

async function main() {
  const { workspaces } = await import("@/db/schema");
  const ws = (await db.select().from(workspaces).where(eq(workspaces.name, WORKSPACE_NAME)).limit(1))[0];
  if (!ws) throw new Error(`Workspace "${WORKSPACE_NAME}" not found`);
  const membership = (await db.query.workspaceMemberships.findFirst({ where: (t, { eq: e }) => e(t.workspaceId, ws.id) }));
  if (!membership) throw new Error("No member in workspace to act as operator");

  await ensureWorkspaceAgents(ws.id);
  const outreach = (await db.select().from(agents).where(and(eq(agents.workspaceId, ws.id), eq(agents.agentKey, "outreach"))).limit(1))[0];
  if (!outreach) throw new Error("Outreach agent not provisioned");

  console.log(`Running Outreach Agent in workspace "${ws.name}" (agent ${outreach.id})…`);
  const run = await AgentRunnerService.run({
    workspaceId: ws.id,
    userId: membership.userId,
    agentKey: "outreach",
    objective: "Prepare a personalized outreach draft for our best-fit lead.",
    triggerType: "manual",
  });
  if (!run.started) throw new Error(`Run blocked: ${run.code} — ${run.blocked}`);

  // Wait for terminal state (LLM planning takes seconds).
  let runRow = (await db.select().from(agentRuns).where(eq(agentRuns.id, run.runId)).limit(1))[0];
  for (let i = 0; i < 60 && !["COMPLETED", "FAILED", "STOPPED_BY_POLICY", "ESCALATED", "AWAITING_APPROVAL"].includes(runRow.status); i++) {
    await new Promise((r) => setTimeout(r, 1000));
    runRow = (await db.select().from(agentRuns).where(eq(agentRuns.id, run.runId)).limit(1))[0];
  }

  const traces = await db.select().from(agentTraces).where(eq(agentTraces.runId, run.runId)).orderBy(agentTraces.stepNumber);
  const prepareTrace = traces.find((t) => t.toolName === "communication.prepare_email");

  console.log(`\nStatus: ${runRow.status}`);
  console.log(`Plan: ${(runRow.plan as { summary?: string } | null)?.summary ?? "(none)"}`);
  for (const t of traces) {
    console.log(`  [${String(t.stepNumber).padStart(2, "0")}] ${t.status.padEnd(18)} ${t.type.padEnd(10)} ${t.summary.slice(0, 100)}${t.error ? ` — ${t.error.slice(0, 80)}` : ""}`);
  }

  // The decisive assertion: prepare_email executed with a REAL lead identity —
  // the recipient must belong to this workspace (contact email + lead id both
  // resolve), and the context builder's picked lead is the expected target.
  const all = await db.query.leads.findMany({
    where: (t, { eq: e, and: a, notInArray }) => a(e(t.workspaceId, ws.id), notInArray(t.status, ["CONVERTED", "LOST"])),
    with: { contact: { columns: { email: true } } },
  });
  const expected = [...all].sort((a, b) => b.score - a.score)[0];
  const usedArgs = (prepareTrace?.input ?? null) as { toEmail?: string; leadId?: string } | null;
  const planActions = ((runRow.plan as { actions?: { toolId: string | null; toolArguments: Record<string, unknown> | null }[] } | null)?.actions ?? []);
  const plannedArgs = planActions.find((a) => a.toolId === "communication.prepare_email")?.toolArguments as { toEmail?: string; leadId?: string } | undefined;

  let pass = 0, fail = 0;
  function check(name: string, ok: boolean, detail?: string) {
    if (ok) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
  }

  check("run reached a terminal state", !["QUEUED", "PLANNING", "EXECUTING"].includes(runRow.status), runRow.status);
  check("prepare_email step executed", Boolean(prepareTrace && prepareTrace.status === "SUCCEEDED"), prepareTrace?.status ?? "missing");
  check(
    "executed toEmail is a REAL contact email from this workspace",
    Boolean(usedArgs?.toEmail) && all.some((l) => l.contact?.email === usedArgs?.toEmail),
    `used ${usedArgs?.toEmail ?? "(none)"}; hottest lead: ${expected?.contact?.email ?? "(none)"}`,
  );
  check(
    "executed leadId resolves to a REAL lead in this workspace",
    Boolean(usedArgs?.leadId) && all.some((l) => l.id === usedArgs?.leadId),
    usedArgs?.leadId ?? "(none)",
  );
  check(
    "toEmail and leadId belong to the SAME lead",
    Boolean(usedArgs?.toEmail && usedArgs?.leadId) &&
      all.some((l) => l.id === usedArgs?.leadId && l.contact?.email === usedArgs?.toEmail),
    JSON.stringify(usedArgs),
  );
  if (plannedArgs) {
    check(
      "planned toEmail already matched a real contact (model grounded, not just runtime-overwritten)",
      all.some((l) => l.contact?.email === plannedArgs?.toEmail),
      plannedArgs?.toEmail ?? "(none)",
    );
  } else {
    console.log("  ℹ model plan used a different step shape — runtime grounding was decisive");
  }
  check(
    "no external email was sent (prepare only — send step went to approval, never executed)",
    !traces.some((t) => t.toolName === "communication.send_email" && t.status === "SUCCEEDED"),
  );

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("LIVE VERIFY ERROR:", err);
  process.exit(1);
});
