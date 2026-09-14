import Link from "next/link";
import { Display, Body, MonoLabel } from "@/components/ui/typography";
import { GlassCard } from "@/components/ui/glass-card";
import { requireWorkspace } from "@/lib/auth/workspace";
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
  const { workspaceId } = await requireWorkspace();

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
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700 ease-out">
      <LiveRefresher intervalMs={15000} />

      <div className="space-y-2 pb-4 border-b border-border-subtle/50">
        <MonoLabel className="text-primary block mb-1">
          <Link href="/agents" className="hover:underline">AGENTS</Link>{" // "}RUNS
        </MonoLabel>
        <Display>Agent Runs</Display>
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
                      <span className={`font-mono-code text-[10px] ${STATUS[run.status] ?? "text-primary"}`}>
                        {run.status}
                      </span>
                      <span className="font-mono-code text-[10px] text-text-muted/70">· {run.triggerType}</span>
                    </div>
                    <p className="mt-1 truncate text-[11px] text-text-secondary">{run.objective}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-4 font-mono-code text-[10px] text-text-muted">
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
