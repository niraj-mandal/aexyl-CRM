"use client";

import { useState } from "react";
import { Display, PageTitle, Body, MonoLabel } from "@/components/ui/typography";
import { GlassCard, GlassPanel } from "@/components/ui/glass-card";
import { Badge } from "@/components/ui/badge";
import { Sparkles, Cpu, CheckCircle2, RefreshCw, TrendingDown, Clock, Building2, AlertTriangle, CalendarClock } from "lucide-react";
import { runPipelineStrategicAuditAction } from "@/app/actions/ai.actions";
import Link from "next/link";

type Audit = Awaited<ReturnType<typeof runPipelineStrategicAuditAction>>;

const severityStyles: Record<string, { badgeVariant: "tertiary" | "secondary" | "primary" | "outline"; icon: React.ReactNode; label: string }> = {
  HIGH: { badgeVariant: "tertiary", icon: <AlertTriangle className="h-3.5 w-3.5 text-tertiary" />, label: "HIGH" },
  WARNING: { badgeVariant: "tertiary", icon: <AlertTriangle className="h-3.5 w-3.5 text-tertiary" />, label: "WARN" },
  NORMAL: { badgeVariant: "secondary", icon: <CheckCircle2 className="h-3.5 w-3.5 text-secondary" />, label: "OK" },
  LOW: { badgeVariant: "outline", icon: <CheckCircle2 className="h-3.5 w-3.5 text-text-muted" />, label: "LOW" },
  EXPANSION: { badgeVariant: "primary", icon: <Building2 className="h-3.5 w-3.5 text-primary" />, label: "GROWTH" },
};

export default function IntelligencePage() {
  const [loading, setLoading] = useState(false);
  const [audit, setAudit] = useState<Audit | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleRunAudit = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await runPipelineStrategicAuditAction();
      setAudit(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Audit failed");
    } finally {
      setLoading(false);
    }
  };

  const m = audit?.metrics;

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-3 duration-500">
      {/* Header Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-border-subtle/50">
        <div>
          <MonoLabel className="text-secondary block mb-1">STRATEGIC PRESETS // EXECUTIVE THINKING MATRIX</MonoLabel>
          <Display>Aexyl Intelligence Matrix</Display>
        </div>
        <div className="flex items-center space-x-3">
          <Badge variant="outline" className="font-mono-code text-[10px]">
            {audit ? `LAST AUDIT: ${new Date(audit.auditedAt).toLocaleTimeString()}` : "NOT YET RUN"}
          </Badge>
          <button
            onClick={handleRunAudit}
            disabled={loading}
            className="inline-flex items-center justify-center space-x-2 rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-white shadow-[0_0_20px_rgba(43,102,255,0.3)] hover:bg-primary/90 disabled:opacity-50 transition-all"
          >
            {loading ? (
              <Cpu className="h-4 w-4 animate-spin text-white" />
            ) : (
              <Sparkles className="h-4 w-4" />
            )}
            <span>{loading ? "Auditing Pipeline..." : audit ? "Re-run Audit" : "Run Strategic Audit"}</span>
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg bg-danger/10 border border-danger/30 p-4 text-xs text-danger flex items-center space-x-2">
          <AlertTriangle className="h-4 w-4" />
          <span>Audit failed: {error}</span>
        </div>
      )}

      {/* Empty state */}
      {!audit && !loading && !error && (
        <GlassPanel className="p-10 text-center">
          <Sparkles className="h-8 w-8 text-primary mx-auto mb-4" />
          <PageTitle className="text-base mb-2">Strategic Audit Engine</PageTitle>
          <Body className="text-xs text-text-muted max-w-md mx-auto leading-relaxed">
            Runs a live risk audit over your entire pipeline: stalled deals, overdue close dates,
            closing-window pressure, lead hygiene, high-value exposure, and account whitespace.
            All metrics computed from your PostgreSQL workspace data.
          </Body>
        </GlassPanel>
      )}

      {/* Metrics Grid */}
      {m && (
        <GlassPanel className="p-6">
          <div className="flex items-center justify-between pb-4 border-b border-border-subtle">
            <div>
              <PageTitle className="text-lg">Executive Telemetry & Risk Radar</PageTitle>
              <Body className="text-xs text-text-muted">
                {m.totalDealsAnalyzed} deals · {m.activeLeadsCount} active leads analyzed
              </Body>
            </div>
            <Badge variant="outline" className="font-mono-code text-[10px]">
              {new Date(audit!.auditedAt).toLocaleTimeString()}
            </Badge>
          </div>

          <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="rounded-lg bg-surface-low p-4 border border-border-subtle">
              <MonoLabel>DEAL STALENESS INDEX</MonoLabel>
              <div className={`mt-2 text-2xl font-bold ${m.stalledDealsCount > 0 ? "text-tertiary" : "text-secondary"}`}>
                {m.dealStalenessIndex}
              </div>
              <p className="mt-1 text-[11px] text-text-muted">{m.stalledDealsCount} open deal(s) idle 7+ days</p>
            </div>

            <div className="rounded-lg bg-surface-low p-4 border border-border-subtle">
              <MonoLabel>REVENUE AT RISK</MonoLabel>
              <div className={`mt-2 text-2xl font-bold ${m.totalRevenueAtRisk > 0 ? "text-tertiary" : "text-secondary"}`}>
                ${m.totalRevenueAtRisk.toLocaleString()}
              </div>
              <p className="mt-1 text-[11px] text-text-muted">Stalled deal value</p>
            </div>

            <div className="rounded-lg bg-surface-low p-4 border border-border-subtle">
              <MonoLabel>OPEN PIPELINE</MonoLabel>
              <div className="mt-2 text-2xl font-bold text-primary">
                ${m.openPipelineValue.toLocaleString()}
              </div>
              <p className="mt-1 text-[11px] text-text-muted">{m.openDealsCount} open deals · avg age {m.avgDealAgeDays}d</p>
            </div>

            <div className="rounded-lg bg-surface-low p-4 border border-border-subtle">
              <MonoLabel>HOT LEADS</MonoLabel>
              <div className="mt-2 text-2xl font-bold text-text-primary">
                {m.highPriorityLeadsCount}
                <span className="text-sm font-medium text-text-muted ml-2">{m.hotLeadRatio}</span>
              </div>
              <p className="mt-1 text-[11px] text-text-muted">Score ≥ 70 or temperature HOT</p>
            </div>
          </div>
        </GlassPanel>
      )}

      {/* Insights */}
      {audit && audit.insights.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          {audit.insights.map((insight) => {
            const style = severityStyles[insight.severity] ?? severityStyles.NORMAL;
            return (
              <GlassPanel key={insight.id} className="p-6 space-y-4">
                <div className="flex items-center justify-between">
                  <Badge variant={style.badgeVariant}>{style.label}</Badge>
                  <span className="font-mono-code text-[10px] text-text-muted">{insight.preset}</span>
                </div>
                <div className="flex items-start space-x-2">
                  {style.icon}
                  <h3 className="text-sm font-semibold text-text-primary leading-snug">{insight.title}</h3>
                </div>
                <p className="text-xs text-text-secondary leading-relaxed">{insight.description}</p>
                {insight.detailUrl && (
                  <div className="pt-3 border-t border-border-subtle">
                    <Link
                      href={insight.detailUrl}
                      className="flex items-center justify-center w-full rounded-lg bg-primary/20 border border-primary/40 p-2 text-center text-xs font-semibold text-primary hover:bg-primary/30 transition-colors"
                    >
                      {insight.actionLabel} →
                    </Link>
                  </div>
                )}
              </GlassPanel>
            );
          })}
        </div>
      )}

      {/* Stalled deals deep-dive */}
      {audit && audit.stalledDealDetails.length > 0 && (
        <GlassPanel className="p-6">
          <div className="flex items-center justify-between pb-4 border-b border-border-subtle">
            <div className="flex items-center space-x-2">
              <Clock className="h-4 w-4 text-tertiary" />
              <PageTitle className="text-base">Stalled Deals — 7+ Days Without Activity</PageTitle>
            </div>
            <Badge variant="tertiary" className="font-mono-code text-[10px]">
              ${audit.metrics.totalRevenueAtRisk.toLocaleString()} AT RISK
            </Badge>
          </div>
          <div className="mt-4 space-y-3">
            {audit.stalledDealDetails.map((deal) => (
              <Link key={deal.id} href={`/sales/deals/${deal.id}`} className="block">
                <div className="flex items-center justify-between rounded-lg bg-surface-low border border-border-subtle p-3.5 hover:border-primary/40 transition-colors">
                  <div>
                    <h4 className="text-xs font-semibold text-text-primary">{deal.name}</h4>
                    <p className="text-[11px] text-text-muted mt-0.5">
                      {deal.company} · {deal.stage.replace("_", " ")} · idle {deal.daysSinceUpdate}d
                    </p>
                  </div>
                  <span className="text-sm font-semibold text-tertiary">${deal.value.toLocaleString()}</span>
                </div>
              </Link>
            ))}
          </div>
        </GlassPanel>
      )}

      {/* Closing soon deep-dive */}
      {audit && audit.closingSoonDeals.length > 0 && (
        <GlassPanel className="p-6">
          <div className="flex items-center justify-between pb-4 border-b border-border-subtle">
            <div className="flex items-center space-x-2">
              <CalendarClock className="h-4 w-4 text-primary" />
              <PageTitle className="text-base">Closing Window — Next 7 Days</PageTitle>
            </div>
            <Badge variant="primary" className="font-mono-code text-[10px]">
              {audit.closingSoonDeals.length} DEALS
            </Badge>
          </div>
          <div className="mt-4 space-y-3">
            {audit.closingSoonDeals.map((deal) => (
              <Link key={deal.id} href={`/sales/deals/${deal.id}`} className="block">
                <div className="flex items-center justify-between rounded-lg bg-surface-low border border-border-subtle p-3.5 hover:border-primary/40 transition-colors">
                  <div>
                    <h4 className="text-xs font-semibold text-text-primary">{deal.name}</h4>
                    <p className="text-[11px] text-text-muted mt-0.5">
                      {deal.company} · {deal.stage.replace("_", " ")} · expected {new Date(deal.expectedCloseDate).toLocaleDateString()}
                    </p>
                  </div>
                  <span className="text-sm font-semibold text-primary">${deal.value.toLocaleString()}</span>
                </div>
              </Link>
            ))}
          </div>
        </GlassPanel>
      )}

      {/* Win rate footer stat */}
      {m && (
        <GlassCard className="p-5 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <TrendingDown className="h-4 w-4 text-secondary" />
            <Body className="text-xs text-text-secondary">
              All-time win rate: <strong className="text-text-primary">{m.winRate}</strong>
            </Body>
          </div>
          <button
            onClick={handleRunAudit}
            disabled={loading}
            className="flex items-center space-x-1.5 text-xs text-primary hover:underline disabled:opacity-50"
          >
            <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
            <span>Refresh audit</span>
          </button>
        </GlassCard>
      )}
    </div>
  );
}
