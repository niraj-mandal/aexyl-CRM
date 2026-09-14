"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { runPipelineStrategicAuditAction } from "@/app/actions/ai.actions";
import type { PipelineAudit } from "@/services/ai/ai-agent.service";
import { GlassCard } from "@/components/ui/glass-card";
import { Badge } from "@/components/ui/badge";
import { MonoLabel } from "@/components/ui/typography";
import { Flame, RefreshCw } from "lucide-react";

const SEVERITY_BADGE: Record<
  PipelineAudit["insights"][number]["severity"],
  "primary" | "secondary" | "tertiary" | "danger"
> = {
  HIGH: "danger",
  WARNING: "tertiary",
  NORMAL: "secondary",
  LOW: "secondary",
  EXPANSION: "primary",
};

/**
 * Daily Operating Brief: runs the real strategic pipeline audit on mount and
 * renders its live metrics, insights, and stalled deals. Every number comes
 * from the workspace database — nothing canned, nothing fabricated.
 */
export function DailyBrief() {
  const [audit, setAudit] = useState<PipelineAudit | null>(null);
  const [loading, setLoading] = useState(true);

  const loadAudit = useCallback(() => {
    setLoading(true);
    return runPipelineStrategicAuditAction()
      .then((a) => setAudit(a))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    let cancelled = false;
    runPipelineStrategicAuditAction()
      .then((a) => {
        if (!cancelled) setAudit(a);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading && !audit) {
    return (
      <GlassCard className="p-5">
        <MonoLabel>DAILY OPERATING BRIEF</MonoLabel>
        <p className="mt-2 text-[11px] text-text-muted">Auditing live pipeline data…</p>
      </GlassCard>
    );
  }

  // The effect completed without a usable audit — say so honestly and offer a
  // retry instead of rendering fake content or silently vanishing.
  if (!audit) {
    return (
      <GlassCard className="p-5">
        <MonoLabel>DAILY OPERATING BRIEF</MonoLabel>
        <div className="mt-2 flex items-center justify-between">
          <p className="text-[11px] text-text-muted">Audit unavailable — could not reach the analysis service.</p>
          <button
            type="button"
            onClick={loadAudit}
            className="flex items-center gap-1 font-mono-code text-[10px] text-primary hover:underline"
          >
            <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} /> retry
          </button>
        </div>
      </GlassCard>
    );
  }

  const m = audit.metrics;

  return (
    <GlassCard className="p-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Flame className="h-3.5 w-3.5 text-primary" />
          <MonoLabel>DAILY OPERATING BRIEF</MonoLabel>
        </div>
        <button
          type="button"
          onClick={loadAudit}
          className="flex items-center gap-1 font-mono-code text-[10px] text-text-muted hover:text-text-primary"
        >
          <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} /> refresh
        </button>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-3 sm:grid-cols-6">
        <div>
          <p className="font-mono-code text-[9px] text-text-muted">OPEN PIPELINE</p>
          <p className="text-sm font-semibold text-text-primary">${m.openPipelineValue.toLocaleString()}</p>
        </div>
        <div>
          <p className="font-mono-code text-[9px] text-text-muted">AT RISK</p>
          <p className={`text-sm font-semibold ${m.totalRevenueAtRisk > 0 ? "text-danger" : "text-text-primary"}`}>
            ${m.totalRevenueAtRisk.toLocaleString()}
          </p>
        </div>
        <div>
          <p className="font-mono-code text-[9px] text-text-muted">STALLED</p>
          <p className="text-sm font-semibold text-text-primary">
            {m.stalledDealsCount}
            <span className="text-[10px] font-normal text-text-muted"> / {m.openDealsCount} open</span>
          </p>
        </div>
        <div>
          <p className="font-mono-code text-[9px] text-text-muted">WIN RATE</p>
          <p className="text-sm font-semibold text-text-primary">{m.winRate}</p>
        </div>
        <div>
          <p className="font-mono-code text-[9px] text-text-muted">AVG AGE</p>
          <p className="text-sm font-semibold text-text-primary">{m.avgDealAgeDays}d</p>
        </div>
        <div>
          <p className="font-mono-code text-[9px] text-text-muted">HIGH-PRI LEADS</p>
          <p className="text-sm font-semibold text-text-primary">{m.highPriorityLeadsCount}</p>
        </div>
      </div>

      {audit.insights.length > 0 ? (
        <div className="mt-4 space-y-1.5 border-t border-border-subtle/40 pt-3">
          {audit.insights.slice(0, 4).map((ins, i) => {
            const content = (
              <>
                <span className="mt-0.5 font-mono-code text-[10px] text-primary">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="truncate text-[11px] font-medium text-text-primary group-hover:text-primary">
                      {ins.title}
                    </span>
                    <Badge variant={SEVERITY_BADGE[ins.severity]} className="font-mono-code text-[8px]">
                      {ins.severity}
                    </Badge>
                  </span>
                  <span className="block truncate text-[10px] text-text-muted">{ins.description}</span>
                </span>
              </>
            );
            return ins.detailUrl ? (
              <Link key={ins.id} href={ins.detailUrl} className="group flex items-start gap-2">
                {content}
              </Link>
            ) : (
              <div key={ins.id} className="flex items-start gap-2">
                {content}
              </div>
            );
          })}
        </div>
      ) : (
        <p className="mt-4 border-t border-border-subtle/40 pt-3 text-[11px] text-text-muted">
          No live insights — the pipeline is clean.
        </p>
      )}

      {audit.stalledDealDetails.length > 0 && (
        <div className="mt-3 space-y-1 border-t border-border-subtle/40 pt-2">
          {audit.stalledDealDetails.slice(0, 3).map((d) => (
            <Link key={d.id} href="/pipeline" className="group flex items-center justify-between gap-2">
              <span className="truncate text-[11px] text-text-secondary group-hover:text-primary">
                {d.name} · {d.company}
              </span>
              <span className="shrink-0 font-mono-code text-[9px] text-text-muted">
                {d.daysSinceUpdate}d stale · ${d.value.toLocaleString()}
              </span>
            </Link>
          ))}
        </div>
      )}

      <p className="mt-3 font-mono-code text-[9px] text-text-muted">
        Audited {new Date(audit.auditedAt).toLocaleTimeString()} · {m.totalDealsAnalyzed} deals ·{" "}
        {m.activeLeadsCount} leads analyzed · staleness index {m.dealStalenessIndex}
      </p>
    </GlassCard>
  );
}
