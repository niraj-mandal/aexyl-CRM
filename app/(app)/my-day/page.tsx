import Link from "next/link";
import { and, desc, eq, sql } from "drizzle-orm";
import { ArrowRight, CalendarDays, CalendarClock, Flame, Inbox, ListChecks, Mail, MoonStar, PhoneCall, Sparkles, Target } from "lucide-react";
import { requireWorkspace } from "@/lib/auth/workspace";
import { CrmService } from "@/services/crm.service";
import { CalendarService, type CalendarEvent } from "@/services/calendar.service";
import { DAILY_GOAL, ScorecardService, TZ, computeStreak, istDayStart, lastDays, type DayStat } from "@/services/scorecard.service";
import { db } from "@/db";
import { agentApprovals, companies, leads } from "@/db/schema";
import { GlassPanel } from "@/components/ui/glass-card";
import { PageHeader } from "@/components/ui/page-header";
import { SectionHeader } from "@/components/ui/section-header";
import { EmptyState } from "@/components/ui/empty-state";
import { SweepButton } from "@/components/crm/SweepButton";
import { DayChecklist, type ChecklistItem, type DoneItem } from "@/components/crm/DayChecklist";
import { LiveRefresher } from "@/components/crm/LiveRefresher";
import { rupees } from "@/lib/stages";

export const dynamic = "force-dynamic";

const OUTCOMES: { key: keyof DayStat; label: string; color: string }[] = [
  { key: "interested", label: "Interested", color: "#2FA36B" },
  { key: "won", label: "Won", color: "#1F7A4D" },
  { key: "notNow", label: "Not now", color: "#8B7CF6" },
  { key: "notInterested", label: "Not interested", color: "#E5322D" },
  { key: "noAnswer", label: "No answer", color: "#9B9BA4" },
];

const KIND: Record<CalendarEvent["kind"], { label: string; color: string }> = {
  MEETING: { label: "Meeting", color: "#2B66FF" },
  FOLLOW_UP: { label: "Follow-up", color: "#F5C84C" },
  TASK: { label: "Task", color: "#8B7CF6" },
  DEAL_CLOSE: { label: "Deal close", color: "#2FA36B" },
  PROJECT_DUE: { label: "Project due", color: "#E5322D" },
};

const fmt = (d: Date | string, opts: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat("en-IN", { timeZone: TZ, ...opts }).format(new Date(d));

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** "You reached 6 gyms: 2 interested, 1 won." */
function wrapUp(t: DayStat): string {
  const parts = OUTCOMES.map((o) => [t[o.key] as number, o.label.toLowerCase()] as const)
    .filter(([n]) => n > 0)
    .map(([n, l]) => `${n} ${l}`);
  return `You reached ${plural(t.contacted, "gym")}${parts.length ? `: ${parts.join(", ")}` : ""}.`;
}

export default async function MyDayPage() {
  const { workspaceId } = await requireWorkspace();

  const todayStart = istDayStart(lastDays(1)[0]);
  const tomorrowStart = new Date(todayStart.getTime() + 86_400_000);
  const dayAfter = new Date(todayStart.getTime() + 2 * 86_400_000);

  const [stats, events, queue, openTasks, doneToday, pendingDrafts] = await Promise.all([
    ScorecardService.getDailyStats(workspaceId, 60),
    CalendarService.getEvents(workspaceId, todayStart, dayAfter),
    CrmService.getPriorityQueue(workspaceId),
    CrmService.getOpenTasks(workspaceId, 20),
    ScorecardService.getDoneSince(workspaceId, todayStart),
    // Agent-prepared follow-up emails waiting on a human decision.
    db
      .select({
        approvalId: agentApprovals.id,
        toEmail: sql<string>`(${agentApprovals.proposedArguments}->>'toEmail')`,
        subject: sql<string>`(${agentApprovals.proposedArguments}->>'subject')`,
        leadCompany: companies.name,
      })
      .from(agentApprovals)
      .leftJoin(leads, eq(leads.id, sql`(${agentApprovals.proposedArguments}->>'leadId')::uuid`))
      .leftJoin(companies, eq(companies.id, leads.companyId))
      .where(
        and(
          eq(agentApprovals.workspaceId, workspaceId),
          eq(agentApprovals.status, "PENDING"),
          eq(agentApprovals.toolName, "communication.send_email"),
        ),
      )
      .orderBy(desc(agentApprovals.requestedAt))
      .limit(5),
  ]);

  const today = stats[stats.length - 1];
  const week = stats.slice(-7);
  const weekTotal = week.reduce((n, d) => n + d.contacted, 0);
  const streak = computeStreak(stats);
  const goalPct = Math.min(100, Math.round((today.contacted / DAILY_GOAL) * 100));
  const barMax = Math.max(DAILY_GOAL, ...week.map((d) => d.contacted));

  const todayEvents = events.filter((e) => new Date(e.when) < tomorrowStart);
  const tomorrowEvents = events.filter((e) => new Date(e.when) >= tomorrowStart);
  const tomorrowFollowUps = tomorrowEvents.filter((e) => e.kind === "FOLLOW_UP").length;

  // Checklist: overdue follow-ups first, then today's agenda in time order, then undated open tasks.
  const timeOf = (e: CalendarEvent) => (e.allDay ? null : fmt(e.when, { hour: "2-digit", minute: "2-digit", hour12: false }));
  const overdue: ChecklistItem[] = (queue.followUpsDue ?? [])
    .filter((l) => l.nextFollowUpAt && new Date(l.nextFollowUpAt) < todayStart)
    .map((l) => ({
      key: `fu-${l.id}`,
      action: { type: "followUp", leadId: l.id },
      title: l.company?.name ?? "Unknown",
      meta: `Follow-up · was due ${fmt(l.nextFollowUpAt!, { day: "numeric", month: "short" })}`,
      time: null,
      color: KIND.FOLLOW_UP.color,
      href: `/sales/leads/${l.id}`,
      overdue: true,
    }));
  const agenda: ChecklistItem[] = todayEvents.map((e) => ({
    key: e.id,
    action: e.kind === "FOLLOW_UP" ? { type: "followUp", leadId: e.sourceId } : e.kind === "TASK" ? { type: "task", taskId: e.sourceId } : null,
    title: e.title,
    meta: [KIND[e.kind].label, e.context].filter(Boolean).join(" · "),
    time: timeOf(e),
    color: KIND[e.kind].color,
    href: e.href,
  }));
  const datedTaskIds = new Set(events.filter((e) => e.kind === "TASK").map((e) => e.sourceId));
  const undatedTasks: ChecklistItem[] = openTasks
    .filter((t) => !datedTaskIds.has(t.id) && (!t.dueAt || new Date(t.dueAt) < todayStart))
    .map((t) => ({
      key: `task-${t.id}`,
      action: { type: "task", taskId: t.id },
      title: t.title,
      meta: ["Task", t.dueAt ? `was due ${fmt(t.dueAt, { day: "numeric", month: "short" })}` : null, t.deal?.name].filter(Boolean).join(" · "),
      time: null,
      color: KIND.TASK.color,
      href: null,
      overdue: Boolean(t.dueAt),
    }));
  const checklist = [...overdue, ...agenda, ...undatedTasks];
  const doneItems: DoneItem[] = [
    ...doneToday.reached.map((r) => ({ key: `r-${r.id}`, title: r.title, meta: r.note, href: `/sales/leads/${r.id}` })),
    ...doneToday.tasksDone.map((t) => ({ key: `t-${t.id}`, title: t.title, meta: "Task", href: null })),
  ];
  // Only gyms you've talked to before; never-contacted ones already sit in the Today list.
  const quietLeads = (queue.staleLeads ?? []).filter((l) => l.lastContactedAt).slice(0, 5);
  const deals = queue.dealsNeedingAttention ?? [];
  const needsYou = pendingDrafts.length + quietLeads.length + deals.length;

  return (
    <div className="space-y-6 animate-in fade-in duration-150">
      <LiveRefresher intervalMs={60000} />

      <PageHeader
        eyebrow={fmt(todayStart, { weekday: "long", day: "numeric", month: "long" })}
        title="My Day"
        description="How today is going, what's on the agenda, and what's lined up for tomorrow."
        actions={<SweepButton />}
      />

      {/* Scorecard */}
      <section aria-label="Today's scorecard" className="grid gap-3 lg:grid-cols-5">
        <GlassPanel className="p-5 lg:col-span-3">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="flex items-center gap-1.5 text-xs font-medium text-text-secondary">
                <Target className="h-3.5 w-3.5 text-primary" /> Today
              </p>
              <p className="mt-2 flex items-baseline gap-2">
                <span className="num text-5xl font-semibold leading-none text-text-primary">{today.contacted}</span>
                <span className="num text-lg text-text-muted">/ {DAILY_GOAL}</span>
                <span className="text-sm text-text-secondary">gyms reached</span>
              </p>
            </div>
            <div
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${
                streak > 0 ? "bg-[#F26B3A]/15 text-[#F26B3A]" : "bg-surface-high text-text-muted"
              }`}
              title={`Days in a row with ${DAILY_GOAL}+ gyms reached`}
            >
              <Flame className="h-3.5 w-3.5" />
              {streak > 0 ? `${plural(streak, "day")} streak` : "No streak yet"}
            </div>
          </div>

          <div
            className="mt-4 h-2 overflow-hidden rounded-full bg-surface-high"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={DAILY_GOAL}
            aria-valuenow={today.contacted}
            aria-label="Daily goal"
          >
            <div
              className="h-full rounded-full transition-[width] duration-700"
              style={{ width: `${goalPct}%`, background: "linear-gradient(90deg, #E5322D, #F26B3A)" }}
            />
          </div>

          <ul className="mt-4 flex flex-wrap gap-2" aria-label="Today's outcomes">
            {OUTCOMES.map((o) => (
              <li
                key={o.key}
                className="inline-flex items-center gap-1.5 rounded-full border border-border-subtle px-2.5 py-1 text-xs text-text-secondary"
              >
                <span className="h-2 w-2 rounded-full" style={{ background: o.color }} />
                {o.label}
                <span className="num font-semibold text-text-primary">{today[o.key]}</span>
              </li>
            ))}
          </ul>
        </GlassPanel>

        <GlassPanel className="p-5 lg:col-span-2">
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium text-text-secondary">Last 7 days</span>
            <span className="num text-text-muted">{weekTotal} reached</span>
          </div>
          <div
            className="relative mt-4 flex h-32 items-end gap-2"
            role="img"
            aria-label={`Gyms reached per day: ${week.map((d) => `${fmt(istDayStart(d.day), { weekday: "short" })} ${d.contacted}`).join(", ")}`}
          >
            {/* goal line */}
            <div
              className="pointer-events-none absolute inset-x-0 border-t border-dashed border-text-muted/40"
              style={{ bottom: `${(DAILY_GOAL / barMax) * 100}%` }}
            />
            {week.map((d, i) => {
              const isToday = i === week.length - 1;
              const h = d.contacted === 0 ? 3 : Math.max(8, (d.contacted / barMax) * 100);
              return (
                <div key={d.day} className="flex h-full flex-1 flex-col items-center justify-end gap-1.5" title={`${d.contacted} reached`}>
                  {d.contacted > 0 && <span className="num text-[11px] text-text-muted">{d.contacted}</span>}
                  <div
                    className={`w-full rounded-md ${isToday ? "" : d.contacted >= DAILY_GOAL ? "bg-text-secondary/70" : "bg-surface-highest"}`}
                    style={{ height: `${h}%`, ...(isToday ? { background: "linear-gradient(180deg, #F26B3A, #E5322D)" } : {}) }}
                  />
                </div>
              );
            })}
          </div>
          <div className="mt-2 flex gap-2">
            {week.map((d, i) => (
              <span key={d.day} className={`flex-1 text-center text-[11px] ${i === week.length - 1 ? "font-semibold text-text-primary" : "text-text-muted"}`}>
                {fmt(istDayStart(d.day), { weekday: "narrow" })}
              </span>
            ))}
          </div>
        </GlassPanel>
      </section>

      <div className="grid gap-6 lg:grid-cols-5">
        {/* Agenda */}
        <GlassPanel className="min-w-0 p-5 lg:col-span-3">
          <SectionHeader icon={ListChecks} title="Today's checklist" meta={`${checklist.filter((i) => i.action).length} to do`} />
          {checklist.length === 0 && doneItems.length === 0 ? (
            <EmptyState
              icon={CalendarDays}
              title="Nothing on today's list"
              body="Follow-ups due, tasks and meetings for today show up here to tick off."
              action={{ href: "/calendar", label: "Open Calendar" }}
            />
          ) : (
            <DayChecklist items={checklist} done={doneItems} />
          )}
        </GlassPanel>

        {/* Wrap-up + tomorrow */}
        <div className="min-w-0 space-y-6 lg:col-span-2">
          <GlassPanel className="p-5">
            <SectionHeader icon={MoonStar} title="Wrap-up" tone="tertiary" />
            {today.contacted === 0 ? (
              <div className="mt-3 space-y-3">
                <p className="text-sm text-text-secondary">No gyms reached yet today.</p>
                <Link
                  href="/"
                  className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-2 text-sm font-semibold text-white shadow-lg shadow-primary/30 transition-transform hover:-translate-y-0.5"
                >
                  <PhoneCall className="h-4 w-4" /> Start calling
                </Link>
              </div>
            ) : (
              <p className="mt-3 text-sm leading-relaxed text-text-secondary">
                {wrapUp(today)}{" "}
                {today.contacted >= DAILY_GOAL ? "Goal hit. 🎉" : `${DAILY_GOAL - today.contacted} more to hit today's goal.`}
              </p>
            )}
          </GlassPanel>

          <GlassPanel className="p-5">
            <SectionHeader icon={CalendarClock} title="Tomorrow" meta={plural(tomorrowEvents.length, "item")} tone="secondary" />
            {tomorrowEvents.length === 0 ? (
              <p className="mt-3 text-sm text-text-muted">Nothing lined up yet. Leads you reach today come back as follow-ups in 2–3 days.</p>
            ) : (
              <>
                <p className="mt-3 text-sm text-text-secondary">
                  {plural(tomorrowFollowUps, "follow-up")}
                  {tomorrowEvents.length > tomorrowFollowUps && ` and ${plural(tomorrowEvents.length - tomorrowFollowUps, "other item")}`} lined up.
                </p>
                <ul className="mt-3 space-y-1.5">
                  {tomorrowEvents.slice(0, 5).map((e) => (
                    <li key={e.id} className="flex items-center gap-2 text-xs">
                      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: KIND[e.kind].color }} />
                      {e.href ? (
                        <Link href={e.href} className="truncate text-text-primary hover:text-primary">{e.title}</Link>
                      ) : (
                        <span className="truncate text-text-primary">{e.title}</span>
                      )}
                    </li>
                  ))}
                  {tomorrowEvents.length > 5 && <li className="text-xs text-text-muted">+{tomorrowEvents.length - 5} more</li>}
                </ul>
              </>
            )}
          </GlassPanel>
        </div>
      </div>

      {/* Needs you */}
      <GlassPanel className="p-5">
        <SectionHeader icon={Inbox} title="Needs you" meta={plural(needsYou, "item")} />
        {needsYou === 0 ? (
          <EmptyState icon={Sparkles} title="All clear" body="No drafts waiting for approval, quiet leads or stuck deals." />
        ) : (
          <div className="mt-4 grid gap-5 md:grid-cols-2">
            {pendingDrafts.length > 0 && (
              <div>
                <p className="mb-2 flex items-center justify-between text-xs font-semibold text-text-primary">
                  <span className="flex items-center gap-1.5">
                    <Mail className="h-3.5 w-3.5 text-primary" /> Drafts waiting for approval
                  </span>
                  <Link href="/agents/approvals" className="font-medium text-primary hover:underline">Review</Link>
                </p>
                <ul className="space-y-1.5">
                  {pendingDrafts.map((d) => (
                    <li key={d.approvalId} className="truncate rounded-lg border border-border-subtle bg-surface-lowest/40 px-3 py-2 text-sm text-text-secondary">
                      <span className="text-text-primary">{d.leadCompany ?? d.toEmail}</span> · {d.subject}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {quietLeads.length > 0 && (
              <div>
                <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-text-primary">
                  <CalendarClock className="h-3.5 w-3.5 text-tertiary" /> Quiet for 7+ days
                </p>
                <ul className="space-y-1.5">
                  {quietLeads.map((l) => (
                    <li key={l.id}>
                      <Link
                        href={`/sales/leads/${l.id}`}
                        className="group flex items-center justify-between gap-2 rounded-lg border border-border-subtle bg-surface-lowest/40 px-3 py-2 hover:border-border-strong"
                      >
                        <span className="truncate text-sm text-text-primary group-hover:text-primary">{l.company?.name ?? "Unknown"}</span>
                        <span className="shrink-0 text-xs text-text-muted">
                          last {fmt(l.lastContactedAt!, { day: "numeric", month: "short" })}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {deals.length > 0 && (
              <div>
                <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-text-primary">
                  <ArrowRight className="h-3.5 w-3.5 text-danger" /> Deals to move
                </p>
                <ul className="space-y-1.5">
                  {deals.slice(0, 5).map((d) => (
                    <li key={d.id}>
                      <Link
                        href={`/sales/deals/${d.id}`}
                        className="group flex items-center justify-between gap-2 rounded-lg border border-border-subtle bg-surface-lowest/40 px-3 py-2 hover:border-border-strong"
                      >
                        <span className="truncate text-sm text-text-primary group-hover:text-primary">{d.name}</span>
                        <span className="num shrink-0 text-xs text-text-muted">
                          {rupees(Number(d.value || 0))} · {d.closesThisWeek ? "closes this week" : "quiet 7+ days"}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </GlassPanel>
    </div>
  );
}
