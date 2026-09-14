"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getDailyBriefAction } from "@/app/actions/production.actions";
import { GlassCard } from "@/components/ui/glass-card";
import { MonoLabel } from "@/components/ui/typography";
import { Flame, RefreshCw } from "lucide-react";

interface Brief {
  generatedAt: string;
  revenue: {
    openPipeline: number;
    weighted: number;
    won90d: number;
    winRate: number | null;
    forecast30d: number | null;
    forecastMethod: string;
  };
  priorities: { label: string; detail: string; href: string }[];
  agentRuns24h: number;
  evidence: string[];
}

/**
 * Daily Operating Brief (spec §20): a morning summary computed from live
 * workspace data — revenue, priorities, agent activity. No fabricated items.
 */
export function DailyBrief() {
  const [brief, setBrief] = useState<Brief | null>(null);
  const [loading, setLoading] = useState(true);

  function load() {
    setLoading(true);
    getDailyBriefAction()
      .then(setBrief)
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    let cancelled = false;
    getDailyBriefAction()
      .then((b) => {
        if (!cancelled) setBrief(b);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading && !brief) {
    return (
      <GlassCard className="p-5">
        <MonoLabel>DAILY OPERATING BRIEF</MonoLabel>
        <p className="mt-2 text-[11px] text-text-muted">Computing from live workspace data…</p>
      </GlassCard>
    );
  }

  if (!brief) return null;

  return (
    <GlassCard className="p-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Flame className="h-3.5 w-3.5 text-primary" />
          <MonoLabel>DAILY OPERATING BRIEF</MonoLabel>
        </div>
        <button
          type="button"
          onClick={load}
          className="flex items-center gap-1 font-mono-code text-[10px] text-text-muted hover:text-text-primary"
        >
          <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} /> refresh
        </button>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div>
          <p className="font-mono-code text-[9px] text-text-muted">OPEN PIPELINE</p>
          <p className="text-sm font-semibold text-text-primary">${brief.revenue.openPipeline.toLocaleString()}</p>
        </div>
        <div>
          <p className="font-mono-code text-[9px] text-text-muted">WEIGHTED</p>
          <p className="text-sm font-semibold text-text-primary">${brief.revenue.weighted.toLocaleString()}</p>
        </div>
        <div>
          <p className="font-mono-code text-[9px] text-text-muted">WON (90D)</p>
          <p className="text-sm font-semibold text-text-primary">
            ${brief.revenue.won90d.toLocaleString()}
            {brief.revenue.winRate !== null && (
              <span className="ml-1 text-[10px] font-normal text-text-muted">{brief.revenue.winRate}% win</span>
            )}
          </p>
        </div>
        <div>
          <p className="font-mono-code text-[9px] text-text-muted">FORECAST (30D)</p>
          <p className="text-sm font-semibold text-text-primary">
            {brief.revenue.forecast30d === null ? "—" : `$${brief.revenue.forecast30d.toLocaleString()}`}
          </p>
        </div>
      </div>

      {brief.priorities.length > 0 && (
        <div className="mt-4 space-y-1.5 border-t border-border-subtle/40 pt-3">
          {brief.priorities.slice(0, 4).map((p, i) => (
            <Link key={i} href={p.href} className="group flex items-start gap-2">
              <span className="mt-0.5 font-mono-code text-[10px] text-primary">{String(i + 1).padStart(2, "0")}</span>
              <span className="min-w-0">
                <span className="block truncate text-[11px] font-medium text-text-primary group-hover:text-primary">
                  {p.label}
                </span>
                {p.detail && <span className="block truncate text-[10px] text-text-muted">{p.detail}</span>}
              </span>
            </Link>
          ))}
        </div>
      )}

      <p className="mt-3 font-mono-code text-[9px] text-text-muted">
        {brief.agentRuns24h} agent runs in last 24h · method: {brief.revenue.forecastMethod}
      </p>
    </GlassCard>
  );
}
