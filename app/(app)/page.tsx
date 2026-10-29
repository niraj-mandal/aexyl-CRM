"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useUser } from "@clerk/nextjs";
import { ArrowUpRight, Building2, Flame, IndianRupee, Kanban, Target, Trophy, Users } from "lucide-react";
import { GlassPanel } from "@/components/ui/glass-card";
import { SectionHeader } from "@/components/ui/section-header";
import { useRealtimeTelemetry } from "@/lib/hooks/use-realtime-telemetry";
import { DailyBrief } from "@/components/crm/DailyBrief";
import { TodayList } from "@/components/crm/TodayList";
import { TeamToday } from "@/components/crm/TeamToday";
import { useCountUp } from "@/components/crm/TodayProgress";
import { DEAL_STAGES, rupees } from "@/lib/stages";
import { CountUp } from "@/components/ui/count-up";
import { useIsSales } from "@/components/providers/role-provider";

const STAGES = DEAL_STAGES.filter((s) => s.key !== "LOST");

// shortcut: fixed goal for everyone; move to workspace settings if the team wants to change it.
const MONTHLY_WIN_GOAL = 5;


/** "Won this month vs goal" ring; the arc and number animate in. */
function GoalRing({ won, goal }: { won: number | null; goal: number }) {
  const shown = useCountUp(won ?? 0);
  const R = 42;
  const C = 2 * Math.PI * R;
  const target = Math.min(1, (won ?? 0) / goal);
  const [frac, setFrac] = useState(0);
  useEffect(() => {
    const id = requestAnimationFrame(() => setFrac(target));
    return () => cancelAnimationFrame(id);
  }, [target]);
  const left = Math.max(0, goal - (won ?? 0));

  return (
    <GlassPanel className="flex items-center gap-5 p-5 transition-transform hover:-translate-y-0.5">
      <div className="relative h-28 w-28 shrink-0">
        <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90" role="img" aria-label={`${won ?? 0} of ${goal} won this month`}>
          <defs>
            <linearGradient id="goal-arc" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#E5322D" />
              <stop offset="100%" stopColor="#F26B3A" />
            </linearGradient>
          </defs>
          <circle cx="50" cy="50" r={R} fill="none" stroke="var(--surface-container-high)" strokeWidth="9" />
          <circle
            cx="50"
            cy="50"
            r={R}
            fill="none"
            stroke="url(#goal-arc)"
            strokeWidth="9"
            strokeLinecap="round"
            strokeDasharray={C}
            strokeDashoffset={C * (1 - frac)}
            className="transition-[stroke-dashoffset] duration-1000 ease-out"
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="num text-2xl font-semibold text-text-primary">
            {won === null ? "—" : shown}
            <span className="text-sm text-text-muted">/{goal}</span>
          </span>
        </div>
      </div>
      <div className="min-w-0">
        <p className="flex items-center gap-1.5 text-xs font-medium text-text-secondary">
          <Target className="h-3.5 w-3.5 text-brand" /> Monthly goal
        </p>
        <p className="mt-1 text-lg font-semibold text-text-primary">Gyms signed</p>
        <p className="mt-1 text-xs text-text-muted">
          {won === null ? "Loading…" : left === 0 ? "Goal hit this month." : `${left} more to hit this month's goal.`}
        </p>
      </div>
    </GlassPanel>
  );
}

function greeting(hour: number) {
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

export default function CommandCenter() {
  const { stats } = useRealtimeTelemetry();
  const isSales = useIsSales();
  // Clerk's live user object re-renders as soon as the profile name is edited.
  const { user: clerkUser } = useUser();
  const name = clerkUser?.firstName || stats?.user?.firstName;
  const now = new Date();
  const stageCounts = stats?.stageCounts ?? {};
  const totalInPipeline = STAGES.reduce((sum, s) => sum + (stageCounts[s.key]?.count ?? 0), 0);

  const kpis = [
    { label: "Active leads", icon: Users, value: stats ? <CountUp value={stats.activeLeads} /> : "—", note: stats ? `${stats.hotLeads} hot` : "", noteIcon: Flame, href: "/sales/leads" },
    // Sales members get no revenue from the server (null), so they don't get this tile either.
    ...(isSales
      ? []
      : [{ label: "Open pipeline", icon: IndianRupee, value: stats ? <CountUp value={stats.pipelineRevenue ?? 0} format={rupees} /> : "—", note: stats ? `${stats.activeDeals} open deals` : "", href: "/sales/pipeline" }]),
    { label: "Win rate", icon: Trophy, value: stats?.winRate ?? "—", note: "won vs all deals", href: "/sales/deals" },
    { label: "Companies", icon: Building2, value: stats ? <CountUp value={stats.activeCompanies} /> : "—", note: "in your CRM", href: "/sales/companies" },
  ];

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-text-muted" suppressHydrationWarning>
            {now.toLocaleDateString("en-IN", { weekday: "short", day: "2-digit", month: "short", year: "numeric" })}
          </p>
          <h1 className="mt-0.5 text-[34px] font-bold leading-tight tracking-tight text-text-primary sm:text-[40px]" suppressHydrationWarning>
            {greeting(now.getHours())}
            {name ? <span className="text-text-muted">, {name}</span> : null}
          </h1>
        </div>
      </header>

      <TodayList />

      {/* Admins see every member's calls and lead status; the API is admin-only too. */}
      {!isSales && <TeamToday />}

      <section aria-label="Key numbers" className="stagger grid grid-cols-2 gap-3 lg:grid-cols-4">
        {kpis.map((k) => (
          <Link key={k.label} href={k.href} className="glass group relative overflow-hidden rounded-xl transition-transform hover:-translate-y-0.5">
            <div className="flex items-center justify-between px-4 pt-3.5">
              <span className="text-xs text-text-secondary">{k.label}</span>
              <k.icon className="h-3.5 w-3.5 text-text-muted transition-colors group-hover:text-primary" />
            </div>
            <div className="px-4 pb-3.5 pt-1.5">
              <p className="num text-2xl font-medium text-text-primary sm:text-[28px]">{k.value}</p>
              <p className="mt-1 flex items-center gap-1 text-xs text-text-muted">
                {k.noteIcon && <k.noteIcon className="h-3 w-3 text-tertiary" />}
                {k.note}
              </p>
            </div>
          </Link>
        ))}
      </section>

      <section aria-label="Goal and pipeline" className="grid gap-3 lg:grid-cols-3">
        <GoalRing won={stats ? stats.wonThisMonth : null} goal={MONTHLY_WIN_GOAL} />

        <GlassPanel className="p-5 lg:col-span-2">
          <SectionHeader
            icon={Kanban}
            title="Pipeline mix"
            meta={`${totalInPipeline} deals`}
            action={
              <Link href="/sales/pipeline" className="flex items-center text-xs font-medium text-primary hover:underline">
                Open board <ArrowUpRight className="ml-1 h-3.5 w-3.5" />
              </Link>
            }
          />
          <div className="mt-4 flex h-3 gap-1" role="img" aria-label="Deals per stage">
            {totalInPipeline === 0 ? (
              <div className="h-full flex-1 rounded-full bg-surface-high" />
            ) : (
              STAGES.map((stage) => {
                const n = stageCounts[stage.key]?.count ?? 0;
                return n > 0 ? (
                  <div
                    key={stage.key}
                    title={`${stage.label}: ${n}`}
                    className="h-full rounded-full transition-[flex-grow] duration-700"
                    style={{ flexGrow: n, flexBasis: 0, minWidth: 10, background: stage.color }}
                  />
                ) : null;
              })
            )}
          </div>
          <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-5">
            {STAGES.map((stage) => {
              const entry = stageCounts[stage.key];
              return (
                <div key={stage.key}>
                  <dt className="flex items-center gap-1.5 text-xs text-text-muted">
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: stage.color }} />
                    {stage.label}
                  </dt>
                  <dd className="num mt-1 text-xl font-medium text-text-primary">{entry?.count ?? 0}</dd>
                  {entry?.value != null && <dd className="num text-xs text-text-muted">{rupees(entry.value)}</dd>}
                </div>
              );
            })}
          </dl>
        </GlassPanel>
      </section>

      {/* Revenue and pipeline-risk audit: admins only (its data is admin-only on the server too). */}
      {!isSales && <DailyBrief />}
    </div>
  );
}
