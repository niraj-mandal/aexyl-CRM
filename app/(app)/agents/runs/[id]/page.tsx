import Link from "next/link";
import { notFound } from "next/navigation";
import { Display, PageTitle, Body, MonoLabel } from "@/components/ui/typography";
import { GlassCard } from "@/components/ui/glass-card";
import { Badge } from "@/components/ui/badge";
import { requireWorkspace } from "@/lib/auth/workspace";
import { db } from "@/db";
import { agentRuns, agentTraces, agentApprovals, agentFeedback } from "@/db/schema";
import { and, asc, eq } from "drizzle-orm";
import { Wrench } from "lucide-react";
import { RunFeedbackButtons } from "@/components/agents/RunFeedbackButtons";

export const dynamic = "force-dynamic";

const TRACE_STATUS: Record<string, string> = {
  SUCCEEDED: "text-success",
  FAILED: "text-danger",
  BLOCKED_BY_POLICY: "text-warning",
  SKIPPED: "text-text-muted",
};

export default async function AgentRunDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { workspaceId, userId } = await requireWorkspace();

  const run = await db.query.agentRuns.findFirst({
    where: and(eq(agentRuns.id, id), eq(agentRuns.workspaceId, workspaceId)),
    with: { agent: true },
  });
  if (!run) notFound();

  const [traces, approvals, feedback] = await Promise.all([
    db
      .select()
      .from(agentTraces)
      .where(eq(agentTraces.runId, run.id))
      .orderBy(asc(agentTraces.stepNumber), asc(agentTraces.createdAt)),
    db.select().from(agentApprovals).where(eq(agentApprovals.runId, run.id)),
    db
      .select({ rating: agentFeedback.rating })
      .from(agentFeedback)
      .where(and(eq(agentFeedback.runId, run.id), eq(agentFeedback.userId, userId)))
      .limit(1),
  ]);

  const startedAt = new Date(run.startedAt);
  const completedAt = run.completedAt ? new Date(run.completedAt) : null;
  const durationMs = completedAt ? completedAt.getTime() - startedAt.getTime() : null;

  const isFinished = ["COMPLETED", "FAILED", "STOPPED_BY_POLICY", "ESCALATED", "CANCELLED"].includes(run.status);

  const plan = (run.plan ?? null) as
    | { summary?: string; actions?: { step: number; description: string; toolId: string | null; requiresApproval?: boolean }[]; confidence?: string; confidenceEvidence?: string[] }
    | null;

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700 ease-out">
      {/* Header */}
      <div className="space-y-2 pb-4 border-b border-border-subtle/50">
        <MonoLabel className="text-primary block mb-1">
          <Link href="/agents" className="hover:underline">AGENTS</Link>{" // "}RUN DETAIL
        </MonoLabel>
        <div className="flex flex-wrap items-center gap-3">
          <Display>{run.agent.name}</Display>
          <Badge
            variant={run.status === "COMPLETED" ? "primary" : run.status === "FAILED" ? "danger" : "tertiary"}
            className="font-mono-code text-[10px]"
          >
            {run.status}
          </Badge>
        </div>
        <Body>{run.objective}</Body>
        {isFinished && (
          <div className="pt-2">
            <RunFeedbackButtons runId={run.id} existingRating={feedback[0]?.rating ?? null} />
          </div>
        )}
      </div>

      {/* Meta strip */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <GlassCard className="p-4">
          <p className="font-mono-code text-[10px] text-text-muted">TRIGGER</p>
          <p className="mt-1 text-xs font-semibold text-text-primary">{run.triggerType}</p>
        </GlassCard>
        <GlassCard className="p-4">
          <p className="font-mono-code text-[10px] text-text-muted">DURATION</p>
          <p className="mt-1 text-xs font-semibold text-text-primary">
            {durationMs !== null ? `${(durationMs / 1000).toFixed(1)}s` : "running…"}
          </p>
        </GlassCard>
        <GlassCard className="p-4">
          <p className="font-mono-code text-[10px] text-text-muted">TOKENS</p>
          <p className="mt-1 text-xs font-semibold text-text-primary">{run.tokensUsed.toLocaleString()}</p>
        </GlassCard>
        <GlassCard className="p-4">
          <p className="font-mono-code text-[10px] text-text-muted">EST. COST</p>
          <p className="mt-1 text-xs font-semibold text-text-primary">
            ${(run.estimatedCostMicroUsd / 1_000_000).toFixed(4)}
          </p>
        </GlassCard>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        {/* Plan */}
        <section className="space-y-4">
          <PageTitle>Plan</PageTitle>
          {plan ? (
            <GlassCard className="space-y-3 p-5">
              <p className="text-xs leading-relaxed text-text-secondary">{plan.summary}</p>
              <div className="flex flex-wrap items-center gap-2">
                {plan.confidence && (
                  <Badge variant="outline" className="font-mono-code text-[9px]">
                    confidence: {plan.confidence.toLowerCase()}
                  </Badge>
                )}
                {plan.confidenceEvidence?.map((e, i) => (
                  <span key={i} className="font-mono-code text-[9px] text-text-muted">
                    · {e}
                  </span>
                ))}
              </div>
              <ol className="space-y-2 pt-1">
                {plan.actions?.map((a) => (
                  <li key={a.step} className="flex items-start gap-2.5 rounded-lg border border-border-subtle/50 bg-surface-lowest/40 p-3">
                    <span className="font-mono-code text-[10px] text-primary">{a.step}</span>
                    <div className="min-w-0">
                      <p className="text-[11px] text-text-primary">{a.description}</p>
                      <p className="mt-0.5 font-mono-code text-[10px] text-text-muted">
                        {a.toolId ?? "analysis"} {a.requiresApproval ? "· needs approval" : ""}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            </GlassCard>
          ) : (
            <GlassCard className="flex min-h-[100px] items-center justify-center">
              <Body className="text-text-muted">No plan recorded.</Body>
            </GlassCard>
          )}

          {/* Result */}
          <PageTitle>Result</PageTitle>
          <GlassCard className="p-5">
            {run.result ? (
              <pre className="max-h-64 overflow-auto whitespace-pre-wrap font-mono-code text-[10px] leading-relaxed text-text-secondary scrollbar-thin">
                {JSON.stringify(run.result, null, 2)}
              </pre>
            ) : run.error ? (
              <p className="text-xs text-danger">{run.error}</p>
            ) : (
              <Body className="text-text-muted">No result captured.</Body>
            )}
          </GlassCard>
        </section>

        {/* Trace timeline */}
        <section className="space-y-4">
          <div className="flex items-center gap-2">
            <Wrench className="h-4 w-4 text-primary" />
            <PageTitle>Execution Trace</PageTitle>
          </div>
          {traces.length === 0 ? (
            <GlassCard className="flex min-h-[120px] items-center justify-center">
              <Body className="text-center text-text-muted">No trace steps recorded.</Body>
            </GlassCard>
          ) : (
            <div className="space-y-2.5">
              {traces.map((t) => (
                <GlassCard key={t.id} className="p-4">
                  <div className="flex items-start gap-3">
                    <span className="font-mono-code text-[10px] text-text-muted">
                      {String(t.stepNumber).padStart(2, "0")}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[11px] font-semibold text-text-primary">{t.summary}</span>
                        <span className={`font-mono-code text-[9px] ${TRACE_STATUS[t.status] ?? "text-primary"}`}>
                          {t.status}
                        </span>
                      </div>
                      <p className="mt-0.5 font-mono-code text-[10px] text-text-muted">
                        {t.type}
                        {t.toolName ? ` · ${t.toolName}` : ""}
                        {t.latencyMs ? ` · ${t.latencyMs}ms` : ""}
                        {t.estimatedCostMicroUsd ? ` · $${(t.estimatedCostMicroUsd / 1_000_000).toFixed(5)}` : ""}
                      </p>
                      {t.error && <p className="mt-1 text-[10px] text-danger">{t.error}</p>}
                      {t.output != null && (
                        <details className="mt-1.5">
                          <summary className="cursor-pointer font-mono-code text-[10px] text-text-muted hover:text-text-secondary">
                            output
                          </summary>
                          <pre className="mt-1 max-h-40 overflow-auto rounded-lg border border-border-subtle/60 bg-surface-lowest/70 p-2 font-mono-code text-[10px] text-text-secondary scrollbar-thin">
                            {JSON.stringify(t.output, null, 2)}
                          </pre>
                        </details>
                      )}
                    </div>
                  </div>
              </GlassCard>
              ))}
            </div>
          )}

          {/* Approvals */}
          {approvals.length > 0 && (
            <>
              <PageTitle>Approvals in this run</PageTitle>
              <div className="space-y-2.5">
                {approvals.map((a) => (
                  <GlassCard key={a.id} className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-[11px] font-semibold text-text-primary">{a.description}</p>
                        <p className="mt-0.5 font-mono-code text-[10px] text-text-muted">
                          {a.toolName} · {a.status.toLowerCase()}
                        </p>
                      </div>
                      <Link href="/agents/approvals" className="shrink-0 text-[11px] text-primary hover:underline">
                        view →
                      </Link>
                    </div>
                  </GlassCard>
                ))}
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
