"use client";

import { Display, PageTitle, Body, MonoLabel } from "@/components/ui/typography";
import { GlassCard, GlassPanel } from "@/components/ui/glass-card";
import { Badge } from "@/components/ui/badge";
import { useRealtimeTelemetry } from "@/lib/hooks/use-realtime-telemetry";
import { SweepButton } from "@/components/crm/SweepButton";
import { DailyBrief } from "@/components/crm/DailyBrief";
import {
  TrendingUp,
  Users,
  DollarSign,
  Activity,
  ArrowUpRight,
  Sparkles,
  AlertCircle,
  CheckCircle2,
  Clock,
} from "lucide-react";
import Link from "next/link";

export default function CommandCenter() {
  const { stats, connected, error } = useRealtimeTelemetry();

  const stageCounts = stats?.stageCounts ?? {};
  const stages = ["QUALIFIED", "CALL_BOOKED", "PROPOSAL", "NEGOTIATION", "WON"];

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-3 duration-500">
      {/* Header Banner & Telemetry */}
      <section className="flex flex-col md:flex-row md:items-end justify-between gap-4 pb-2 border-b border-border-subtle/50">
        <div>
          <MonoLabel className="text-primary block mb-1">COMMAND CENTER // EXECUTIVE TELEMETRY</MonoLabel>
          <Display>Welcome back, {stats?.user?.firstName ?? "Operator"}.</Display>
        </div>
        <div className="flex items-center space-x-3">
          <Badge variant={connected ? "secondary" : "outline"} className="font-mono-code text-[11px]">
            STREAM: {connected ? "LIVE 5s" : "OFFLINE"}
          </Badge>
          <Badge variant="secondary" className="font-mono-code text-[11px]">
            HEALTH: {stats?.pipelineHealth ?? "—"}
          </Badge>
          <Badge variant="outline" className="font-mono-code text-[11px]">
            LATENCY: {stats ? `${stats.latencyMs}ms` : "—"}
          </Badge>
        </div>
      </section>

      {/* Daily Operating Brief */}
      <DailyBrief />

      {/* KPI Metric Bento Grid */}
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <GlassCard className="group relative overflow-hidden p-5 transition-all hover:border-primary/40">
          <div className="flex items-center justify-between">
            <MonoLabel>OPEN PIPELINE</MonoLabel>
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/10 text-primary">
              <DollarSign className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline justify-between">
            <span className="text-2xl font-semibold tracking-tight text-text-primary">
              ${(stats?.pipelineRevenue ?? 0).toLocaleString()}
            </span>
            <span className="flex items-center text-xs font-medium text-secondary">
              <TrendingUp className="mr-1 h-3 w-3" /> {stats?.activeDeals ?? 0} open
            </span>
          </div>
          <p className="mt-1 text-[11px] text-text-muted">
            Total incl. closed-won: ${(stats?.totalPipelineValue ?? 0).toLocaleString()}
          </p>
        </GlassCard>

        <GlassCard className="group relative overflow-hidden p-5 transition-all hover:border-primary/40">
          <div className="flex items-center justify-between">
            <MonoLabel>ACTIVE LEADS</MonoLabel>
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-secondary/10 text-secondary">
              <Users className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline justify-between">
            <span className="text-2xl font-semibold tracking-tight text-text-primary">
              {stats?.activeLeads ?? 0} Leads
            </span>
            <span className="flex items-center text-xs font-medium text-secondary">
              <Sparkles className="mr-1 h-3 w-3" /> {stats?.hotLeads ?? 0} hot
            </span>
          </div>
          <p className="mt-1 text-[11px] text-text-muted">{stats?.activeCompanies ?? 0} active companies in workspace</p>
        </GlassCard>

        <GlassCard className="group relative overflow-hidden p-5 transition-all hover:border-primary/40">
          <div className="flex items-center justify-between">
            <MonoLabel>WIN CONVERSION RATE</MonoLabel>
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-tertiary/10 text-tertiary">
              <Activity className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline justify-between">
            <span className="text-2xl font-semibold tracking-tight text-text-primary">{stats?.winRate ?? "—"}</span>
            <span className="text-xs font-medium text-text-muted">All-time</span>
          </div>
          <p className="mt-1 text-[11px] text-text-muted">Computed from won vs total deals</p>
        </GlassCard>

        <GlassCard className="group relative overflow-hidden p-5 transition-all hover:border-primary/40">
          <div className="flex items-center justify-between">
            <MonoLabel>PIPELINE HEALTH</MonoLabel>
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/20 text-primary">
              <CheckCircle2 className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline justify-between">
            <span className="text-2xl font-semibold tracking-tight text-text-primary">{stats?.pipelineHealth ?? "—"}</span>
            <Badge variant="primary" className="text-[10px]">Fresh &lt; 14d</Badge>
          </div>
          <p className="mt-1 text-[11px] text-text-muted">
            {error ? `Stream error: ${error}` : `Updated ${stats ? new Date(stats.updatedAt).toLocaleTimeString() : "—"}`}
          </p>
        </GlassCard>
      </section>

      {/* Main Workspace 2-Column Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: Pipeline + Queue */}
        <div className="lg:col-span-2 space-y-6">
          <GlassPanel className="p-6">
            <div className="flex items-center justify-between pb-4 border-b border-border-subtle">
              <div>
                <PageTitle className="text-lg">Live Pipeline Breakdown</PageTitle>
                <Body className="text-xs text-text-muted">Open + closed stages, straight from PostgreSQL</Body>
              </div>
              <Link href="/pipeline" className="flex items-center text-xs font-medium text-primary hover:underline">
                Open Pipeline Board <ArrowUpRight className="ml-1 h-3.5 w-3.5" />
              </Link>
            </div>

            <div className="mt-4 grid grid-cols-2 sm:grid-cols-5 gap-3 text-center">
              {stages.map((stage) => {
                const entry = stageCounts[stage];
                return (
                  <div key={stage} className="rounded-lg bg-surface-low p-3 border border-border-subtle">
                    <MonoLabel>{stage.replace("_", " ")}</MonoLabel>
                    <div className="mt-1 text-lg font-bold text-text-primary">{entry?.count ?? 0}</div>
                    <div className="text-[10px] text-text-muted">${(entry?.value ?? 0).toLocaleString()}</div>
                  </div>
                );
              })}
            </div>
          </GlassPanel>

          <GlassPanel className="p-6">
            <div className="flex items-center justify-between pb-4 border-b border-border-subtle">
              <div>
                <PageTitle className="text-lg">Work Queue</PageTitle>
                <Body className="text-xs text-text-muted">Follow-ups due, hot leads, quiet deals — computed live from your CRM state</Body>
              </div>
              <div className="flex items-center space-x-3">
                <SweepButton
                  label="Sweep Follow-ups"
                  className="inline-flex items-center justify-center space-x-2 rounded-lg bg-surface-low border border-primary/30 px-3 py-1.5 text-xs font-semibold text-primary hover:bg-primary/10 disabled:opacity-50 transition-all"
                />
                <Link href="/my-day" className="flex items-center text-xs font-medium text-primary hover:underline">
                  View My Day <ArrowUpRight className="ml-1 h-3.5 w-3.5" />
                </Link>
              </div>
            </div>

            <div className="mt-4 space-y-3">
              {(stats?.hotLeads ?? 0) === 0 && (stats?.activeDeals ?? 0) === 0 ? (
                <div className="rounded-lg bg-surface-low border border-border-subtle p-6 text-center text-xs text-text-muted">
                  Nothing pending. Add leads and deals to populate your work queue.
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-between rounded-lg bg-surface-low border border-border-subtle p-3.5 transition-colors hover:border-primary/40">
                    <div className="flex items-center space-x-3">
                      <div className="flex h-8 w-8 items-center justify-center rounded-md bg-tertiary/10 text-tertiary">
                        <AlertCircle className="h-4 w-4" />
                      </div>
                      <div>
                        <h4 className="text-xs font-semibold text-text-primary">{stats?.hotLeads ?? 0} hot leads need attention</h4>
                        <p className="text-[11px] text-text-muted">Score ≥ 70 or temperature HOT — engage today</p>
                      </div>
                    </div>
                    <Link href="/leads">
                      <Badge variant="tertiary" className="font-mono-code text-[10px]">LEADS</Badge>
                    </Link>
                  </div>

                  <div className="flex items-center justify-between rounded-lg bg-surface-low border border-border-subtle p-3.5 transition-colors hover:border-primary/40">
                    <div className="flex items-center space-x-3">
                      <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/10 text-primary">
                        <Clock className="h-4 w-4" />
                      </div>
                      <div>
                        <h4 className="text-xs font-semibold text-text-primary">
                          ${(stats?.pipelineRevenue ?? 0).toLocaleString()} of open pipeline
                        </h4>
                        <p className="text-[11px] text-text-muted">Across {stats?.activeDeals ?? 0} active deals</p>
                      </div>
                    </div>
                    <Link href="/pipeline">
                      <Badge variant="outline" className="font-mono-code text-[10px]">PIPELINE</Badge>
                    </Link>
                  </div>

                  <div className="flex items-center justify-between rounded-lg bg-surface-low border border-border-subtle p-3.5 transition-colors hover:border-primary/40">
                    <div className="flex items-center space-x-3">
                      <div className="flex h-8 w-8 items-center justify-center rounded-md bg-secondary/10 text-secondary">
                        <CheckCircle2 className="h-4 w-4" />
                      </div>
                      <div>
                        <h4 className="text-xs font-semibold text-text-primary">{stats?.winRate ?? "—"} all-time win rate</h4>
                        <p className="text-[11px] text-text-muted">
                          {stats?.activeCompanies ?? 0} active companies · {stats?.activeLeads ?? 0} active leads
                        </p>
                      </div>
                    </div>
                    <Link href="/clients">
                      <Badge variant="secondary" className="font-mono-code text-[10px]">CLIENTS</Badge>
                    </Link>
                  </div>
                </>
              )}
            </div>
          </GlassPanel>
        </div>

        {/* Right Column: Intelligence & Telemetry */}
        <div className="space-y-6">
          <GlassPanel className="p-6 border-primary/30 shadow-[0_0_30px_rgba(43,102,255,0.1)]">
            <div className="flex items-center space-x-2 pb-3 border-b border-border-subtle">
              <Sparkles className="h-4 w-4 text-primary" />
              <PageTitle className="text-base text-primary">Aexyl Intelligence</PageTitle>
            </div>

            <div className="mt-4 space-y-4">
              <div className="rounded-lg bg-surface-low/80 p-3.5 border border-border-subtle">
                <Badge variant="primary" className="mb-2 font-mono-code text-[9px]">INSIGHT #01</Badge>
                <h4 className="text-xs font-medium text-text-primary">Pipeline Staleness Monitor</h4>
                <p className="mt-1 text-[11px] text-text-secondary leading-relaxed">
                  {(stats?.pipelineHealth ?? "0%")} of open deals have activity within 14 days. Anything below 80% warrants follow-up sweeps.
                </p>
              </div>

              <div className="rounded-lg bg-surface-low/80 p-3.5 border border-border-subtle">
                <Badge variant="tertiary" className="mb-2 font-mono-code text-[9px]">SLO ATTENTION</Badge>
                <h4 className="text-xs font-medium text-text-primary">Conversion Snapshot</h4>
                <p className="mt-1 text-[11px] text-text-secondary leading-relaxed">
                  Win rate is {stats?.winRate ?? "—"} across all recorded deals. Target 30%.
                </p>
              </div>
            </div>

            <Link href="/intelligence" className="mt-5 block w-full rounded-lg bg-primary/10 border border-primary/30 p-2.5 text-center text-xs font-medium text-primary hover:bg-primary/20 transition-colors">
              Open Strategic Thinking Matrix →
            </Link>
          </GlassPanel>

          {/* Realtime System Telemetry */}
          <GlassCard className="p-5">
            <MonoLabel className="block mb-3">SYSTEM TELEMETRY</MonoLabel>
            <div className="space-y-2.5 text-xs font-mono-code">
              <div className="flex justify-between text-text-muted">
                <span>Database Stream:</span>
                <span className={connected ? "text-secondary" : "text-danger"}>
                  {connected ? "LIVE · 5s POLL" : "OFFLINE"}
                </span>
              </div>
              <div className="flex justify-between text-text-muted">
                <span>Stream Latency:</span>
                <span className="text-primary">{stats ? `${stats.latencyMs}ms` : "—"}</span>
              </div>
              <div className="flex justify-between text-text-muted">
                <span>Auth Provider:</span>
                <span className="text-text-primary">Clerk Authenticated</span>
              </div>
              <div className="flex justify-between text-text-muted">
                <span>Last Pulse:</span>
                <span className="text-text-primary">
                  {stats ? new Date(stats.updatedAt).toLocaleTimeString() : "—"}
                </span>
              </div>
            </div>
          </GlassCard>
        </div>
      </div>
    </div>
  );
}
