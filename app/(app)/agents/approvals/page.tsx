import { Display, PageTitle, Body, MonoLabel } from "@/components/ui/typography";
import { GlassCard } from "@/components/ui/glass-card";
import { requireWorkspace } from "@/lib/auth/workspace";
import { db } from "@/db";
import { agents, agentApprovals } from "@/db/schema";
import { desc, eq } from "drizzle-orm";
import { expireStaleApprovals } from "@/agents/services/approvals.service";
import { ApprovalCard, type ApprovalItem } from "@/components/agents/ApprovalCard";
import { LiveRefresher } from "@/components/crm/LiveRefresher";
import { format } from "date-fns";

export const dynamic = "force-dynamic";

export default async function ApprovalsPage() {
  const { workspaceId } = await requireWorkspace();
  await expireStaleApprovals(workspaceId);

  const rows = await db
    .select({
      id: agentApprovals.id,
      toolName: agentApprovals.toolName,
      actionType: agentApprovals.actionType,
      description: agentApprovals.description,
      riskLevel: agentApprovals.riskLevel,
      proposedArguments: agentApprovals.proposedArguments,
      impactSummary: agentApprovals.impactSummary,
      status: agentApprovals.status,
      requestedAt: agentApprovals.requestedAt,
      expiresAt: agentApprovals.expiresAt,
      agentName: agents.name,
    })
    .from(agentApprovals)
    .innerJoin(agents, eq(agentApprovals.agentId, agents.id))
    .where(eq(agentApprovals.workspaceId, workspaceId))
    .orderBy(desc(agentApprovals.requestedAt));

  const pending = rows.filter((r) => r.status === "PENDING");
  const decided = rows.filter(
    (r) => ["APPROVED", "REJECTED", "EXPIRED", "CANCELLED", "EXECUTED"].includes(r.status)
  );

  const section = (title: string, items: typeof rows) => (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <PageTitle>{title}</PageTitle>
        <span className="font-mono-code text-[10px] text-text-muted">{items.length}</span>
      </div>
      {items.length === 0 ? (
        <GlassCard className="flex min-h-[90px] items-center justify-center">
          <Body className="text-center text-text-muted">Nothing here.</Body>
        </GlassCard>
      ) : (
        <div className="space-y-3">
          {items.map((a) => (
            <ApprovalCard
              key={a.id}
              approval={
                {
                  id: a.id,
                  agentName: a.agentName,
                  toolName: a.toolName,
                  actionType: a.actionType,
                  description: a.description,
                  riskLevel: a.riskLevel,
                  proposedArguments: a.proposedArguments,
                  impactSummary: a.impactSummary,
                  requestedAt: format(new Date(a.requestedAt), "MMM d, HH:mm"),
                  expiresAt: format(new Date(a.expiresAt), "MMM d, HH:mm"),
                } satisfies ApprovalItem
              }
            />
          ))}
        </div>
      )}
    </section>
  );

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700 ease-out">
      <LiveRefresher intervalMs={20000} />

      <div className="space-y-2 pb-4 border-b border-border-subtle/50">
        <MonoLabel className="text-primary block mb-1">
          AGENTS // HUMAN-IN-THE-LOOP
        </MonoLabel>
        <Display>Approval Center</Display>
        <Body>
          Agent actions that mutate data wait here. Nothing executes until a human approves —
          approvals expire, and dry-runs simulate without side effects.
        </Body>
      </div>

      {section("Pending", pending)}
      {section("Decided", decided)}
    </div>
  );
}
