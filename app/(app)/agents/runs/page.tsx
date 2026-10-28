import Link from "next/link";
import { Display, Body } from "@/components/ui/typography";
import { GlassCard } from "@/components/ui/glass-card";
import { requireAdminPage } from "@/lib/auth/workspace";
import { db } from "@/db";
import { agents, agentRuns } from "@/db/schema";
import { desc, eq } from "drizzle-orm";
import { LiveRefresher } from "@/components/crm/LiveRefresher";
import { formatDistanceToNowStrict } from "date-fns";

export const dynamic = "force-dynamic";

const STATUS: Record<string, string> = {
  COMPLETED: "text-success",
  FAILED: "text-danger",
  STOPPED_BY_POLICY: "text-warning",
  AWAITING_APPROVAL: "text-warning",
  CANCELLED: "text-text-muted",
};

export default async function AgentRunsPage() {
  const { workspaceId } = await requireAdminPage();

  const runs = await db
    .select({
      id: agentRuns.id,
      status: agentRuns.status,
      objective: agentRuns.objective,
      triggerType: agentRuns.triggerType,
      tokensUsed: agentRuns.tokensUsed,
      estimatedCostMicroUsd: agentRuns.estimatedCostMicroUsd,
      createdAt: agentRuns.createdAt,
      agentName: agents.name,
      agentKey: agents.agentKey,
    })
    .from(agentRuns)
    .innerJoin(agents, eq(agentRuns.agentId, agents.id))
    .where(eq(agentRuns.workspaceId, workspaceId))
    .orderBy(desc(agentRuns.createdAt))
    .limit(50);

  return (
    <div className="space-y-8">
      <LiveRefresher intervalMs={60000} />

      <div className="space-y-2">
        <p className="text-sm font-semibold text-text-muted"><Link href="/agents" className="hover:text-text-primary">Agents</Link></p>
        <Display>Runs</Display>
        <Body>Every execution with its plan, tools, approvals, cost, and outcome.</Body>
      </div>

      {runs.length === 0 ? (
        <GlassCard className="flex min-h-[140px] items-center justify-center">
          <Body className="text-center text-text-muted">
            No runs yet. Start one from the <Link href="/agents" className="text-primary hover:underline">Command Center</Link>.
          </Body>
        </GlassCard>
      ) : (
        <div className="space-y-3">
          {runs.map((run) => (
            <Link key={run.id} href={`/agents/runs/${run.id}`} className="block">
              <GlassCard className="p-4 transition-all hover:border-primary/40">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-text-primary">{run.agentName}</span>
                      <span className={`font-mono-code text-xs ${STATUS[run.status] ?? "text-primary"}`}>
                        {run.status}
                      </span>
                      <span className="font-mono-code text-xs text-text-muted/70">· {run.triggerType}</span>
                    </div>
                    <p className="mt-1 truncate text-xs text-text-secondary">{run.objective}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-4 font-mono-code text-xs text-text-muted">
                    <span>{run.tokensUsed.toLocaleString()} tok</span>
                    <span>${(run.estimatedCostMicroUsd / 1_000_000).toFixed(4)}</span>
                    <span>{formatDistanceToNowStrict(new Date(run.createdAt), { addSuffix: true })}</span>
                    <span className="text-primary">→</span>
                  </div>
                </div>
              </GlassCard>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
