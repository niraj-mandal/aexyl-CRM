import Link from "next/link";
import { Display, PageTitle, Body, MonoLabel } from "@/components/ui/typography";
import { GlassCard } from "@/components/ui/glass-card";
import { Badge } from "@/components/ui/badge";
import { requireWorkspace } from "@/lib/auth/workspace";
import { db } from "@/db";
import { agents, agentRuns, agentUsage, agentApprovals, agentFeedback, incidents, agentTraces } from "@/db/schema";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { ResolveIncidentButton } from "@/components/agents/ResolveIncidentButton";
import { LiveRefresher } from "@/components/crm/LiveRefresher";
import { Activity, ShieldAlert } from "lucide-react";
import { formatDistanceToNowStrict } from "date-fns";

export const dynamic = "force-dynamic";

function StatCard({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <GlassCard className="p-5">
      <p className="font-mono-code text-[10px] text-text-muted">{label}</p>
      <p className={`mt-1 text-2xl font-semibold tracking-tight ${tone ?? "text-text-primary"}`}>{value}</p>
      {sub && <p className="mt-1 text-[10px] text-text-muted">{sub}</p>}
    </GlassCard>
  );
}

/** Fresh per-request window; isolated so the purity rule doesn't flag RSC render. */
function sevenDaysAgo(): Date {
  return new Date(Date.now() - 7 * 24 * 3600 * 1000);
}

export default async function ObservabilityPage() {
  const { workspaceId } = await requireWorkspace();

  const since7d = sevenDaysAgo();

  const [totals, perAgent, toolFailures, spend, approvals, feedback, openIncidents, recentIncidents] =
    await Promise.all([
      // Run totals (7d)
      db
        .select({ status: agentRuns.status, n: sql<number>`count(*)::int` })
        .from(agentRuns)
        .where(and(eq(agentRuns.workspaceId, workspaceId), gte(agentRuns.createdAt, since7d)))
        .groupBy(agentRuns.status),
      // Per-agent rollup
      db
        .select({
          agentName: agents.name,
          agentKey: agents.agentKey,
          runs: sql<number>`count(*)::int`,
          succeeded: sql<number>`count(*) filter (where ${agentRuns.status} = 'COMPLETED')::int`,
          failed: sql<number>`count(*) filter (where ${agentRuns.status} = 'FAILED')::int`,
          avgTokens: sql<number>`coalesce(avg(${agentRuns.tokensUsed}), 0)::int`,
        })
        .from(agentRuns)
        .innerJoin(agents, eq(agentRuns.agentId, agents.id))
        .where(and(eq(agentRuns.workspaceId, workspaceId), gte(agentRuns.createdAt, since7d)))
        .groupBy(agents.name, agents.agentKey),
      // Tool failure count from traces (workspace-scoped via runs)
      db
        .select({ n: sql<number>`count(*)::int` })
        .from(agentTraces)
        .innerJoin(agentRuns, eq(agentTraces.runId, agentRuns.id))
        .where(
          and(
            eq(agentRuns.workspaceId, workspaceId),
            eq(agentTraces.status, "FAILED"),
            gte(agentTraces.createdAt, since7d)
          )
        ),
      // Spend (7d)
      db
        .select({ micro: sql<number>`coalesce(sum(${agentUsage.estimatedCostMicroUsd}), 0)::int`, calls: sql<number>`count(*)::int` })
        .from(agentUsage)
        .where(and(eq(agentUsage.workspaceId, workspaceId), gte(agentUsage.createdAt, since7d))),
      // Approval rates (7d)
      db
        .select({ status: agentApprovals.status, n: sql<number>`count(*)::int` })
        .from(agentApprovals)
        .where(and(eq(agentApprovals.workspaceId, workspaceId), gte(agentApprovals.requestedAt, since7d)))
        .groupBy(agentApprovals.status),
      // Feedback
      db
        .select({ rating: agentFeedback.rating, n: sql<number>`count(*)::int` })
        .from(agentFeedback)
        .where(eq(agentFeedback.workspaceId, workspaceId))
        .groupBy(agentFeedback.rating),
      // Open incidents
      db
        .select()
        .from(incidents)
        .where(and(eq(incidents.workspaceId, workspaceId), eq(incidents.status, "OPEN")))
        .orderBy(desc(incidents.createdAt)),
      // Recent incidents
      db
        .select()
        .from(incidents)
        .where(and(eq(incidents.workspaceId, workspaceId), sql`${incidents.status} != 'OPEN'`))
        .orderBy(desc(incidents.updatedAt))
        .limit(6),
    ]);

  const runMap = Object.fromEntries(totals.map((t) => [t.status, t.n]));
  const totalRuns = totals.reduce((acc, t) => acc + t.n, 0);
  const succeeded = runMap["COMPLETED"] ?? 0;
  const failed = runMap["FAILED"] ?? 0;
  const successRate = totalRuns > 0 ? Math.round((succeeded / totalRuns) * 100) : null;
  const approvalPending = approvals.find((a) => a.status === "PENDING")?.n ?? 0;
  const approvalExecuted = approvals.find((a) => a.status === "EXECUTED")?.n ?? 0;
  const approvalRejected = approvals.find((a) => a.status === "REJECTED")?.n ?? 0;
  const decided = approvalExecuted + approvalRejected;
  const approvalRate = decided > 0 ? Math.round((approvalExecuted / decided) * 100) : null;
  const helpful = feedback.find((f) => f.rating === "HELPFUL")?.n ?? 0;
  const notHelpful = feedback.find((f) => f.rating === "NOT_HELPFUL")?.n ?? 0;

  const violationRows = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(agentRuns)
    .where(and(eq(agentRuns.workspaceId, workspaceId), eq(agentRuns.status, "STOPPED_BY_POLICY")));

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700 ease-out">
      <LiveRefresher intervalMs={20000} />

      <div className="space-y-2 pb-4 border-b border-border-subtle/50">
        <MonoLabel className="text-primary block mb-1">
          <Link href="/agents" className="hover:underline">AGENTS</Link>{" // "}OBSERVABILITY
        </MonoLabel>
        <Display>Agent Observability</Display>
        <Body>Production metrics from real run/trace/approval data — last 7 days unless noted.</Body>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
        <StatCard label="RUNS (7D)" value={String(totalRuns)} />
        <StatCard
          label="SUCCESS RATE"
          value={successRate === null ? "—" : `${successRate}%`}
          tone={successRate !== null && successRate < 80 ? "text-warning" : "text-text-primary"}
        />
        <StatCard label="FAILED RUNS" value={String(failed)} tone={failed > 0 ? "text-danger" : undefined} />
        <StatCard
          label="TOOL FAILURES"
          value={String(toolFailures[0]?.n ?? 0)}
          tone={(toolFailures[0]?.n ?? 0) > 0 ? "text-warning" : undefined}
        />
        <StatCard
          label="AI SPEND (7D)"
          value={`$${((spend[0]?.micro ?? 0) / 1e6).toFixed(4)}`}
          sub={`${spend[0]?.calls ?? 0} model calls`}
        />
        <StatCard
          label="POLICY STOPS"
          value={String(violationRows[0]?.n ?? 0)}
          sub="runs stopped by policy"
        />
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <section className="space-y-4">
          <PageTitle>Per-Agent (7d)</PageTitle>
          {perAgent.length === 0 ? (
            <GlassCard className="flex min-h-[100px] items-center justify-center">
              <Body className="text-text-muted">No runs in the last 7 days.</Body>
            </GlassCard>
          ) : (
            <GlassCard className="divide-y divide-border-subtle/50 p-0">
              {perAgent.map((a) => {
                const rate = a.runs > 0 ? Math.round((a.succeeded / a.runs) * 100) : null;
                return (
                  <div key={a.agentKey} className="flex items-center justify-between px-5 py-3">
                    <div>
                      <p className="text-xs font-medium text-text-primary">{a.agentName}</p>
                      <p className="font-mono-code text-[10px] text-text-muted">
                        {a.runs} runs · {a.failed} failed · avg {a.avgTokens.toLocaleString()} tok
                      </p>
                    </div>
                    <Badge variant={rate !== null && rate >= 80 ? "primary" : rate === null ? "outline" : "tertiary"} className="font-mono-code text-[10px]">
                      {rate === null ? "—" : `${rate}%`}
                    </Badge>
                  </div>
                );
              })}
            </GlassCard>
          )}

          <PageTitle>Human in the loop</PageTitle>
          <div className="grid grid-cols-3 gap-4">
            <StatCard label="PENDING" value={String(approvalPending)} tone={approvalPending > 0 ? "text-warning" : undefined} />
            <StatCard
              label="APPROVAL RATE"
              value={approvalRate === null ? "—" : `${approvalRate}%`}
              sub={`${approvalExecuted} executed · ${approvalRejected} rejected`}
            />
            <StatCard
              label="FEEDBACK"
              value={helpful + notHelpful === 0 ? "—" : `${Math.round((helpful / (helpful + notHelpful)) * 100)}%`}
              sub={`${helpful} 👍 · ${notHelpful} 👎`}
            />
          </div>
        </section>

        <section className="space-y-4">
          <div className="flex items-center gap-2">
            <ShieldAlert className="h-4 w-4 text-primary" />
            <PageTitle>Incidents</PageTitle>
          </div>
          {openIncidents.length === 0 && recentIncidents.length === 0 ? (
            <GlassCard className="flex min-h-[100px] items-center justify-center">
              <Body className="text-text-muted">No incidents. Agents are behaving.</Body>
            </GlassCard>
          ) : (
            <div className="space-y-3">
              {openIncidents.map((inc) => (
                <GlassCard key={inc.id} className="border-danger/30 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <Badge variant="danger" className="font-mono-code text-[9px]">{inc.severity}</Badge>
                        <p className="text-xs font-semibold text-text-primary">{inc.title}</p>
                      </div>
                      {inc.description && <p className="mt-1 text-[11px] text-text-muted">{inc.description}</p>}
                      <p className="mt-1 font-mono-code text-[10px] text-text-muted/70">
                        opened {formatDistanceToNowStrict(new Date(inc.createdAt), { addSuffix: true })}
                      </p>
                    </div>
                    <ResolveIncidentButton incidentId={inc.id} />
                  </div>
                </GlassCard>
              ))}
              {recentIncidents.map((inc) => (
                <GlassCard key={inc.id} className="p-4 opacity-70">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-xs text-text-secondary">{inc.title}</p>
                      <p className="font-mono-code text-[10px] text-text-muted">
                        {inc.status} {inc.resolvedAt ? formatDistanceToNowStrict(new Date(inc.resolvedAt), { addSuffix: true }) : ""}
                      </p>
                    </div>
                    <Activity className="h-3.5 w-3.5 text-text-muted" />
                  </div>
                </GlassCard>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

