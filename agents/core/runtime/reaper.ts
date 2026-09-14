/**
 * Run reaper — reliability guarantee (Phase 6 spec §7): no agent run is ever
 * left permanently RUNNING. Runs whose worker died (dev server restart, crash)
 * are marked TIMEOUT after the max-runtime window; transient failures are
 * retried with backoff up to a cap; repeated failures escalate.
 *
 * Invocation is pull-based (agents pages, processPending) so it works without
 * any background worker in dev, and from a cron/worker in production.
 */
import { db } from "@/db";
import { agents, agentRuns, incidents } from "@/db/schema";
import { and, eq, inArray, lt, sql } from "drizzle-orm";
import { logger } from "@/lib/logger";

const MAX_RUNTIME_MS = 10 * 60 * 1000; // 10 min hard ceiling per run
const MAX_ATTEMPTS = 3;

export interface ReaperSummary {
  timedOut: string[];
  retried: string[];
  escalated: string[];
}

export async function reapStaleRuns(workspaceId?: string): Promise<ReaperSummary> {
  const cutoff = new Date(Date.now() - MAX_RUNTIME_MS);
  const stale = await db
    .select()
    .from(agentRuns)
    .where(
      workspaceId
        ? and(
            eq(agentRuns.status, "RUNNING"),
            lt(agentRuns.startedAt, cutoff),
            eq(agentRuns.workspaceId, workspaceId)
          )
        : and(eq(agentRuns.status, "RUNNING"), lt(agentRuns.startedAt, cutoff))
    )
    .limit(25);

  const summary: ReaperSummary = { timedOut: [], retried: [], escalated: [] };

  for (const run of stale) {
    const attempts = ((run.inputContext as { attempts?: number } | null)?.attempts ?? 1);

    if (attempts < MAX_ATTEMPTS) {
      // Transient — queue a retry by flipping to RETRYING; the runner picks it
      // up on the next processPending/agents load. Attempt counter lives in
      // input_context so it survives process restarts.
      const ctx = { ...((run.inputContext as Record<string, unknown>) ?? {}), attempts: attempts + 1 };
      await db
        .update(agentRuns)
        .set({ status: "RETRYING", inputContext: ctx, error: "Run timed out; scheduled for retry" })
        .where(eq(agentRuns.id, run.id));
      summary.retried.push(run.id);
      continue;
    }

    // Exhausted — fail + escalate.
    await db
      .update(agentRuns)
      .set({ status: "FAILED", error: "Exceeded max runtime after retries — escalated", completedAt: new Date() })
      .where(eq(agentRuns.id, run.id));
    summary.escalated.push(run.id);

    const [incident] = await db
      .insert(incidents)
      .values({
        workspaceId: run.workspaceId,
        title: `Agent run escalated after repeated timeouts`,
        description: `Run ${run.id} exceeded max runtime ${MAX_ATTEMPTS} times. Objective: ${run.objective.slice(0, 200)}`,
        status: "OPEN",
        severity: "SEV2",
        source: "system",
        metadata: { runId: run.id, kind: "run_timeout_escalation" },
      })
      .returning();
    void incident;

    const [agentRow] = await db.select().from(agents).where(eq(agents.id, run.agentId)).limit(1);
    logger.warn("agent run escalated", { runId: run.id, agentKey: agentRow?.agentKey, workspaceId: run.workspaceId });
  }

  return summary;
}

/**
 * Failure-spike detector: if an agent failed ≥ N runs in the last hour, open
 * an incident (deduped by an OPEN incident for the same agent).
 */
export async function detectFailureSpikes(workspaceId: string): Promise<{ opened: boolean; agentKeys: string[] }> {
  const since = new Date(Date.now() - 60 * 60 * 1000);
  const failed = await db
    .select({ agentId: agentRuns.agentId, n: sql<number>`count(*)::int` })
    .from(agentRuns)
    .where(and(eq(agentRuns.workspaceId, workspaceId), eq(agentRuns.status, "FAILED"), sql`${agentRuns.createdAt} >= ${since.toISOString()}`))
    .groupBy(agentRuns.agentId);

  const opened: string[] = [];
  for (const row of failed) {
    if ((row.n ?? 0) < 5) continue;
    const [agentRow] = await db.select().from(agents).where(eq(agents.id, row.agentId)).limit(1);
    if (!agentRow) continue;

    const existing = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(incidents)
      .where(
        and(
          eq(incidents.workspaceId, workspaceId),
          eq(incidents.status, "OPEN"),
          sql`${incidents.metadata}->>'agentKey' = ${agentRow.agentKey}`
        )
      );
    if ((existing[0]?.n ?? 0) > 0) continue;

    await db.insert(incidents).values({
      workspaceId,
      title: `${agentRow.name} failure spike`,
      description: `${row.n} failed runs in the last hour. Review traces before re-enabling autonomous behavior.`,
      status: "OPEN",
      severity: "SEV2",
      source: "system",
      metadata: { agentKey: agentRow.agentKey, kind: "failure_spike", failures: row.n },
    });
    opened.push(agentRow.agentKey);
  }
  return { opened: opened.length > 0, agentKeys: opened };
}

/** Mark RETRYING runs back to RUNNING when the runner picks them up. */
export async function claimRetryingRuns(workspaceId: string, limit = 3): Promise<string[]> {
  const retrying = await db
    .select({ id: agentRuns.id })
    .from(agentRuns)
    .where(and(eq(agentRuns.workspaceId, workspaceId), eq(agentRuns.status, "RETRYING")))
    .limit(limit);
  if (retrying.length === 0) return [];
  const ids = retrying.map((r) => r.id);
  await db.update(agentRuns).set({ status: "RUNNING", error: null }).where(inArray(agentRuns.id, ids));
  return ids;
}
