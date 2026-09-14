import Link from "next/link";
import { notFound } from "next/navigation";
import { Display, PageTitle, Body, MonoLabel } from "@/components/ui/typography";
import { GlassCard } from "@/components/ui/glass-card";
import { Badge } from "@/components/ui/badge";
import { requireWorkspace } from "@/lib/auth/workspace";
import { db } from "@/db";
import { agents, agentRuns } from "@/db/schema";
import { and, desc, eq } from "drizzle-orm";
import { AgentSettingsForm } from "@/components/agents/AgentSettingsForm";
import { getAgentDefinition } from "@/agents/registry";
import { Bot } from "lucide-react";
import { formatDistanceToNowStrict } from "date-fns";

export const dynamic = "force-dynamic";

const STATUS_DOT: Record<string, string> = {
  COMPLETED: "text-success",
  FAILED: "text-danger",
  STOPPED_BY_POLICY: "text-warning",
  AWAITING_APPROVAL: "text-warning",
  CANCELLED: "text-text-muted",
};

export default async function AgentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { workspaceId } = await requireWorkspace();

  const agent = await db.query.agents.findFirst({
    where: and(eq(agents.workspaceId, workspaceId), eq(agents.agentKey, id)),
  });
  if (!agent || agent.agentKey === "__kill_switch") notFound();

  const runs = await db
    .select()
    .from(agentRuns)
    .where(eq(agentRuns.agentId, agent.id))
    .orderBy(desc(agentRuns.createdAt))
    .limit(12);

  const def = getAgentDefinition(agent.agentKey);

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700 ease-out">
      {/* Header */}
      <div className="flex flex-col gap-4 pb-4 border-b border-border-subtle/50 lg:flex-row lg:items-center lg:justify-between">
        <section className="space-y-2">
          <MonoLabel className="text-primary block mb-1">
            <Link href="/agents" className="hover:underline">AGENTS</Link>{" // "}{agent.agentKey.toUpperCase()}
          </MonoLabel>
          <Display>{agent.name}</Display>
          <Body>{agent.description}</Body>
        </section>
        <Badge variant={agent.enabled ? "primary" : "outline"} className="font-mono-code text-[10px]">
          {agent.enabled ? "ENABLED" : "DISABLED"} · {agent.version}
        </Badge>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-5">
        {/* Settings */}
        <div className="space-y-6 xl:col-span-3">
          <section className="space-y-4">
            <div className="flex items-center gap-2">
              <Bot className="h-4 w-4 text-primary" />
              <PageTitle>Settings</PageTitle>
            </div>
            <GlassCard className="p-6">
              <AgentSettingsForm
                agentKey={agent.agentKey}
                name={agent.name}
                initial={{
                  enabled: agent.enabled,
                  autonomyLevel: agent.autonomyLevel,
                  allowedTools: agent.allowedTools,
                  dailyRunLimit: agent.dailyRunLimit,
                  maxTokensPerRun: agent.maxTokensPerRun,
                  dailyBudgetMicroUsd: agent.dailyBudgetMicroUsd,
                  requiresApprovalForWrites: agent.requiresApprovalForWrites,
                }}
              />
            </GlassCard>
          </section>

          {def && (
            <section className="space-y-3">
              <PageTitle>What this agent does</PageTitle>
              <GlassCard className="space-y-2 p-5">
                <p className="text-xs leading-relaxed text-text-secondary">
                  {def.description}
                </p>
                <p className="font-mono-code text-[10px] text-text-muted">
                  planner: LLM via AI Gateway (deterministic fallback) · prompt version {def.version} ·
                  default autonomy L{def.defaultAutonomy}
                </p>
              </GlassCard>
            </section>
          )}
        </div>

        {/* Runs */}
        <div className="space-y-4 xl:col-span-2">
          <PageTitle>Run History</PageTitle>
          {runs.length === 0 ? (
            <GlassCard className="flex min-h-[120px] items-center justify-center">
              <Body className="text-center text-text-muted">
                No runs yet. Run it from the Command Center.
              </Body>
            </GlassCard>
          ) : (
            <div className="space-y-3">
              {runs.map((run) => (
                <Link key={run.id} href={`/agents/runs/${run.id}`} className="block">
                  <GlassCard className="p-4 transition-all hover:border-primary/40">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-[11px] text-text-primary">{run.objective}</p>
                        <p className="mt-0.5 font-mono-code text-[10px] text-text-muted">
                          {run.triggerType} · {run.tokensUsed} tokens · ${" "}
                          {(run.estimatedCostMicroUsd / 1_000_000).toFixed(4)}
                        </p>
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
        </div>
      </div>
    </div>
  );
}
