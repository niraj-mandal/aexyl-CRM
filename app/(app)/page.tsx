"use client";

import Link from "next/link";
import { useUser } from "@clerk/nextjs";
import { ArrowUpRight, Building2, Flame, IndianRupee, Kanban, Trophy, Users } from "lucide-react";
import { GlassPanel } from "@/components/ui/glass-card";
import { SectionHeader } from "@/components/ui/section-header";
import { useRealtimeTelemetry } from "@/lib/hooks/use-realtime-telemetry";
import { DailyBrief } from "@/components/crm/DailyBrief";
import { TodayList } from "@/components/crm/TodayList";

const STAGES = [
  { key: "QUALIFIED", label: "Qualified" },
  { key: "CALL_BOOKED", label: "Call booked" },
  { key: "PROPOSAL", label: "Proposal" },
  { key: "NEGOTIATION", label: "Negotiation" },
  { key: "WON", label: "Won" },
];

const rupees = (n: number) => `₹${n.toLocaleString("en-IN")}`;

function greeting(hour: number) {
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

export default function CommandCenter() {
  const { stats, connected } = useRealtimeTelemetry();
  // Clerk's live user object re-renders as soon as the profile name is edited.
  const { user: clerkUser } = useUser();
  const name = clerkUser?.firstName || stats?.user?.firstName;
  const now = new Date();
  const stageCounts = stats?.stageCounts ?? {};
  const totalInPipeline = STAGES.reduce((sum, s) => sum + (stageCounts[s.key]?.count ?? 0), 0);

  const kpis = [
    { label: "Active leads", icon: Users, value: stats ? String(stats.activeLeads) : "—", note: stats ? `${stats.hotLeads} hot` : "", noteIcon: Flame, href: "/sales/leads" },
    { label: "Open pipeline", icon: IndianRupee, value: stats ? rupees(stats.pipelineRevenue) : "—", note: stats ? `${stats.activeDeals} open deals` : "", href: "/sales/pipeline" },
    { label: "Win rate", icon: Trophy, value: stats?.winRate ?? "—", note: "won vs all deals", href: "/sales/deals" },
    { label: "Companies", icon: Building2, value: stats ? String(stats.activeCompanies) : "—", note: "in your CRM", href: "/sales/companies" },
  ];

  return (
    <div className="space-y-6 animate-in fade-in duration-150">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="num text-xs uppercase tracking-wider text-text-muted" suppressHydrationWarning>
            {now.toLocaleDateString("en-IN", { weekday: "short", day: "2-digit", month: "short", year: "numeric" })}
          </p>
          <h1 className="mt-1.5 text-3xl font-semibold tracking-tight text-text-primary sm:text-4xl" suppressHydrationWarning>
            {greeting(now.getHours())}
            {name ? <span className="text-text-muted">, {name}</span> : null}
          </h1>
        </div>
        <span className="num inline-flex items-center gap-2 rounded-full border border-border-subtle bg-surface-low/70 px-3 py-1 text-[11px] uppercase tracking-wider text-text-muted">
          <span className={`h-1.5 w-1.5 rounded-full ${connected ? "bg-secondary shadow-[0_0_8px_var(--secondary)]" : "bg-text-muted"}`} />
          {connected ? "Synced" : "Connecting"}
        </span>
      </header>

      <TodayList />

      <section aria-label="Key numbers" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {kpis.map((k) => (
          <Link key={k.label} href={k.href} className="glass group relative overflow-hidden rounded-xl transition-transform hover:-translate-y-0.5">
            <div className="bg-stripes flex items-center justify-between border-b border-border-subtle px-4 py-2.5">
              <span className="text-xs text-text-secondary">{k.label}</span>
              <k.icon className="h-3.5 w-3.5 text-text-muted transition-colors group-hover:text-primary" />
            </div>
            <div className="px-4 py-3.5">
              <p className="num text-2xl font-medium text-text-primary sm:text-[28px]">{k.value}</p>
              <p className="mt-1 flex items-center gap-1 text-xs text-text-muted">
                {k.noteIcon && <k.noteIcon className="h-3 w-3 text-tertiary" />}
                {k.note}
              </p>
            </div>
          </Link>
        ))}
      </section>

      <GlassPanel className="p-5">
        <SectionHeader
          icon={Kanban}
          title="Pipeline"
          meta={`${totalInPipeline} deals`}
          action={
            <Link href="/sales/pipeline" className="flex items-center text-xs font-medium text-primary hover:underline">
              Open board <ArrowUpRight className="ml-1 h-3.5 w-3.5" />
            </Link>
          }
        />
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
          {STAGES.map((stage, i) => {
            const entry = stageCounts[stage.key];
            return (
              <div key={stage.key} className="relative rounded-lg border border-border-subtle bg-surface-lowest/60 p-3">
                <div className="flex items-center justify-between">
                  <p className="text-xs text-text-muted">{stage.label}</p>
                  <span className="num text-[11px] text-text-muted/60">0{i + 1}</span>
                </div>
                <p className="num mt-2 text-xl font-medium text-text-primary">{entry?.count ?? 0}</p>
                <p className="num text-xs text-text-muted">{rupees(entry?.value ?? 0)}</p>
                <div className="absolute inset-x-3 bottom-0 h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
              </div>
            );
          })}
        </div>
      </GlassPanel>

      <DailyBrief />
    </div>
  );
}
