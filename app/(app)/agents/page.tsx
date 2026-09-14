import Link from "next/link";
import { Display, PageTitle, Body, MonoLabel } from "@/components/ui/typography";
import { GlassCard } from "@/components/ui/glass-card";
import { Badge } from "@/components/ui/badge";
import { requireWorkspace } from "@/lib/auth/workspace";
import { db } from "@/db";
import { agents, agentRuns, automationRules } from "@/db/schema";
import { desc, eq } from "drizzle-orm";
import { getAgentsOverview, getPendingApprovals } from "@/app/actions/agents.actions";
import { KillSwitchButton } from "@/components/agents/KillSwitchButton";
import { RunAgentButton } from "@/components/agents/RunAgentButton";
import { LiveRefresher } from "@/components/crm/LiveRefresher";
import { Bot, CircleDot, ShieldBan, Zap } from "lucide-react";
import { formatDistanceToNowStrict } from "date-fns";

export const dynamic = "force-dynamic";

const AUTONOMY_LABEL: Record<number, string> = {
  0: "L0 · Observe",
  1: "L1 · Recommend",
  2: "L2 · Prepare",
  3: "L3 · Execute approved",
};

const STATUS_DOT: Record<string, string> = {
  COMPLETED: "text-success",
  FAILED: "text-danger",
  STOPPED_BY_POLICY: "text-warning",
  AWAITING_APPROVAL: "text-warning",
  CANCELLED: "text-text-muted",
};

export default async function AgentsPage() {
  const { workspaceId } = await requireWorkspace();

  const [{ agents: agentRows, killSwitchEngaged }, recentRuns, pendingApprovals, rules] =
    await Promise.all([
      getAgentsOverview(workspaceId),
      db
        .select({
          id: agentRuns.id,
          status: agentRuns.status,
          objective: agentRuns.objective,
          triggerType: agentRuns.triggerType,
          createdAt: agentRuns.createdAt,
          agentName: agents.name,
          agentKey: agents.agentKey,
        })
        .from(agentRuns)
        .innerJoin(agents, eq(agentRuns.agentId, agents.id))
        .where(eq(agentRuns.workspaceId, workspaceId))
        .orderBy(desc(agentRuns.createdAt))
        .limit(8),
      getPendingApprovals(workspaceId),
      db
        .select({
          id: automationRules.id,
          name: automationRules.name,
          eventType: automationRules.eventType,
          enabled: automationRules.enabled,
          agentName: agents.name,
        })
        .from(automationRules)
        .innerJoin(agents, eq(automationRules.agentId, agents.id))
        .where(eq(automationRules.workspaceId, workspaceId))
        .orderBy(automationRules.name),
    ]);

  const enabledCount = agentRows.filter((a) => a.enabled).length;
  const activeCount = agentRows.filter((a) => a.enabled).length;

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700 ease-out">
      <LiveRefresher intervalMs={15000} />

      {/* Header */}
      <div className="flex flex-col gap-4 pb-4 border-b border-border-subtle/50 lg:flex-row lg:items-center lg:justify-between">
        <section className="space-y-2">
          <MonoLabel className="text-primary block mb-1">AGENTIC LAYER // CONTROLLED SOFTWARE ACTORS</MonoLabel>
          <Display>Aexyl Agents</Display>
          <Body>
            {enabledCount} of {agentRows.length} agents enabled · every action planned, policy-checked, and audited. Writes require human approval.
          </Body>
        </section>
        <div className="flex items-center gap-4">
          {killSwitchEngaged && (
            <Badge variant="danger" className="font-mono-code text-[10px]">
              <ShieldBan className="mr-1 h-3 w-3" /> ALL AGENTS DISABLED
            </Badge>
          )}
          <KillSwitchButton engaged={killSwitchEngaged} />
        </div>
      </div>

      {/* Active agents grid */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Bot className="h-4 w-4 text-primary" />
            <PageTitle>Active Agents</PageTitle>
          </div>
          <Badge variant="outline" className="font-mono-code text-[10px]">
            {activeCount} monitoring
          </Badge>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {agentRows.map((agent) => (
            <GlassCard key={agent.id} className="flex flex-col justify-between p-5">
              <div className="space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <Link href={`/agents/${agent.agentKey}`} className="group">
                    <h3 className="text-sm font-semibold text-text-primary transition-colors group-hover:text-primary">
                      {agent.name}
                    </h3>
                  </Link>
                  <span
                    className={`flex items-center gap-1.5 font-mono-code text-[10px] ${
                      agent.enabled ? "text-success" : "text-text-muted"
                    }`}
                  >
                    <CircleDot className={`h-3 w-3 ${agent.enabled ? "text-success" : "text-text-muted"}`} />
                    {agent.enabled ? "Monitoring" : "Disabled"}
                  </span>
                </div>
                <p className="text-[11px] leading-relaxed text-text-muted line-clamp-2">{agent.description}</p>
                <div className="flex flex-wrap gap-1.5 pt-1">
                  <Badge variant="outline" className="font-mono-code text-[9px]">
                    {AUTONOMY_LABEL[agent.autonomyLevel] ?? `L${agent.autonomyLevel}`}
                  </Badge>
                  <Badge variant="outline" className="font-mono-code text-[9px]">
                    {agent.allowedTools.length} tools
                  </Badge>
                  {agent.requiresApprovalForWrites && (
                    <Badge variant="secondary" className="font-mono-code text-[9px]">
                      writes need approval
                    </Badge>
                  )}
                </div>
              </div>
              <div className="mt-4 flex items-center justify-between">
                <Link
                  href={`/agents/${agent.agentKey}`}
                  className="text-[11px] text-text-muted transition-colors hover:text-primary"
                >
                  Settings & runs →
                </Link>
                <RunAgentButton agentKey={agent.agentKey} disabled={!agent.enabled || killSwitchEngaged} />
              </div>
            </GlassCard>
          ))}
        </div>
      </section>

      {/* Two-column: approvals + recent activity */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <PageTitle>Pending Approvals</PageTitle>
            <Link href="/agents/approvals" className="text-[11px] text-text-muted hover:text-primary">
              Approval Center →
            </Link>
          </div>
          {pendingApprovals.length === 0 ? (
            <GlassCard className="flex min-h-[120px] items-center justify-center">
              <Body className="text-center text-text-muted">No agent actions awaiting approval.</Body>
            </GlassCard>
          ) : (
            <div className="space-y-3">
              {pendingApprovals.slice(0, 4).map((a) => (
                <GlassCard key={a.id} className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-text-primary">{a.description}</p>
                      <p className="mt-1 font-mono-code text-[10px] text-text-muted">
                        {a.toolName} · risk {a.riskLevel}
                      </p>
                    </div>
                    <Link
                      href="/agents/approvals"
                      className="shrink-0 rounded-lg border border-primary/40 bg-primary/15 px-2.5 py-1.5 text-[11px] font-semibold text-primary transition-colors hover:bg-primary/25"
                    >
                      Review
                    </Link>
                  </div>
                </GlassCard>
              ))}
            </div>
          )}
        </section>

        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <PageTitle>Recent Agent Activity</PageTitle>
            <Link href="/agents/runs" className="text-[11px] text-text-muted hover:text-primary">
              All runs →
            </Link>
          </div>
          {recentRuns.length === 0 ? (
            <GlassCard className="flex min-h-[120px] items-center justify-center">
              <Body className="text-center text-text-muted">
                No runs yet. Hit Run on any agent to see the full plan → tool → audit trail.
              </Body>
            </GlassCard>
          ) : (
            <div className="space-y-3">
              {recentRuns.map((run) => (
                <Link key={run.id} href={`/agents/runs/${run.id}`} className="block">
                  <GlassCard className="p-4 transition-all hover:border-primary/40">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-text-primary">{run.agentName}</p>
                        <p className="mt-0.5 truncate text-[11px] text-text-muted">{run.objective}</p>
                      </div>
                      <div className="shrink-0 text-right">
                        <span className={`font-mono-code text-[10px] ${STATUS_DOT[run.status] ?? "text-primary"}`}>
                          {run.status}
                        </span>
                        <p className="mt-0.5 font-mono-code text-[10px] text-text-muted/70">
                          {formatDistanceToNowStrict(new Date(run.createdAt), { addSuffix: true })}
                        </p>
                      </div>
                    </div>
                  </GlassCard>
                </Link>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* Automation rules */}
      <section className="space-y-4">
        <div className="flex items-center gap-2">
          <Zap className="h-4 w-4 text-primary" />
          <PageTitle>Event Automations</PageTitle>
        </div>
        {rules.length === 0 ? (
          <GlassCard className="flex min-h-[100px] items-center justify-center">
            <Body className="text-center text-text-muted">No automation rules configured.</Body>
          </GlassCard>
        ) : (
          <GlassCard className="divide-y divide-border-subtle/50 overflow-hidden p-0">
            {rules.map((rule) => (
              <div key={rule.id} className="flex items-center justify-between gap-3 px-5 py-3.5">
                <div className="flex min-w-0 items-center gap-3">
                  <span
                    className={`h-1.5 w-1.5 shrink-0 rounded-full ${rule.enabled ? "bg-success" : "bg-text-muted/40"}`}
                  />
                  <div className="min-w-0">
                    <p className="truncate text-xs font-medium text-text-primary">{rule.name}</p>
                    <p className="font-mono-code text-[10px] text-text-muted">
                      when <span className="text-primary">{rule.eventType}</span> → {rule.agentName}
                    </p>
                  </div>
                </div>
                <Badge variant={rule.enabled ? "primary" : "outline"} className="font-mono-code text-[9px]">
                  {rule.enabled ? "ENABLED" : "OFF"}
                </Badge>
              </div>
            ))}
          </GlassCard>
        )}
      </section>
    </div>
  );
}
