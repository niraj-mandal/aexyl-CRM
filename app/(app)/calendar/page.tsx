import { requireWorkspace } from "@/lib/auth/workspace";
import { CalendarService } from "@/services/calendar.service";
import { CalendarGrid } from "@/components/crm/CalendarGrid";
import { EventContextMenu } from "@/components/crm/EventContextMenu";
import { ScheduleMeetingButton } from "@/components/crm/ScheduleMeetingButton";
import { GlassCard } from "@/components/ui/glass-card";
import { MonoLabel } from "@/components/ui/typography";
import { PageHeader } from "@/components/ui/page-header";
import { SectionHeader } from "@/components/ui/section-header";
import { EmptyState } from "@/components/ui/empty-state";
import { CalendarDays, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";
import { format } from "date-fns";

export const dynamic = "force-dynamic";

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const KIND_LABEL: Record<string, string> = {
  MEETING: "Meeting",
  TASK: "Task",
  DEAL_CLOSE: "Deal close",
  FOLLOW_UP: "Follow-up",
  PROJECT_DUE: "Project",
};

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ y?: string; m?: string }>;
}) {
  const { workspaceId } = await requireWorkspace();
  const params = await searchParams;

  const now = new Date();
  const year = clampInt(params.y, 1970, 2100, now.getFullYear());
  const month = clampInt(params.m, 1, 12, now.getMonth() + 1);

  const [monthData, upcoming] = await Promise.all([
    CalendarService.getMonth(workspaceId, year, month),
    CalendarService.getUpcomingMeetings(workspaceId, 8),
  ]);

  const { events, counts } = monthData;
  const upcomingMeetings = upcoming.filter(
    (m) => new Date(m.occurredAt) >= new Date(now.getFullYear(), now.getMonth(), now.getDate())
  );

  // Agenda list for the visible month, grouped by day.
  const agendaByDay = new Map<string, typeof events>();
  for (const e of events) {
    const key = format(new Date(e.when), "yyyy-MM-dd");
    const list = agendaByDay.get(key);
    if (list) list.push(e);
    else agendaByDay.set(key, [e]);
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-150">
      <PageHeader
        eyebrow="Overview"
        title="Calendar"
        description="Meetings, follow-ups, task deadlines, deal close dates and project due dates in one place."
        actions={<ScheduleMeetingButton />}
      />

      <CalendarGrid
        year={year}
        month={month}
        events={events}
        monthName={MONTH_NAMES[month - 1]}
      />

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Month agenda */}
        <GlassCard>
          <div className="mb-4">
            <SectionHeader icon={CalendarDays} title={`${MONTH_NAMES[month - 1]} agenda`} meta={`${events.length} items`} />
          </div>
          {events.length === 0 ? (
            <EmptyState
              icon={CalendarDays}
              title="Nothing this month"
              body="Follow-ups you set on leads and meetings you schedule show up here and on the grid."
            />
          ) : (
            <div className="space-y-4 max-h-[420px] overflow-y-auto pr-1">
              {Array.from(agendaByDay.entries()).map(([day, dayEvents]) => (
                <div key={day}>
                  <MonoLabel className="text-text-muted mb-1.5 block">
                    {format(new Date(day), "EEE d MMM yyyy")}
                  </MonoLabel>
                  <div className="space-y-1.5">
                    {dayEvents.map((e) => (
                      <EventContextMenu key={e.id} event={e}>
                        <Link
                          href={e.href ?? "#"}
                          className="flex items-center gap-3 rounded-lg border border-border-subtle/60 bg-surface-lowest/40 px-3 py-2 hover:bg-surface-elevated/60 transition group"
                        >
                        <span className="font-mono-code text-xs text-text-muted w-12 shrink-0">
                          {e.allDay
                            ? "all-day"
                            : format(new Date(e.when), "HH:mm")}
                        </span>
                        <span className="flex-1 min-w-0 text-sm text-text-primary group-hover:text-primary transition">
                          <span className="block truncate">{e.title}</span>
                          {e.context && (
                            <span className="block truncate text-xs text-text-muted">
                              {e.context}
                            </span>
                          )}
                        </span>
                        <Badge variant="secondary" className="font-mono-code text-xs shrink-0">
                          {KIND_LABEL[e.kind] ?? e.kind}
                        </Badge>
                        </Link>
                      </EventContextMenu>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </GlassCard>

        {/* Upcoming meetings rail */}
        <GlassCard>
          <div className="mb-4">
            <SectionHeader icon={Users} title="Upcoming meetings" meta={`${counts.MEETING} this month`} />
          </div>
          {upcomingMeetings.length === 0 ? (
            <EmptyState
              icon={Users}
              title="No meetings booked"
              body="When a gym agrees to meet, schedule it here. It also shows on that lead's timeline."
              action={<ScheduleMeetingButton />}
            />
          ) : (
            <div className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
              {upcomingMeetings.map((m) => (
                <div
                  key={m.id}
                  className="rounded-lg border border-border-subtle/60 bg-surface-lowest/40 px-3 py-2.5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium text-text-primary truncate">
                      {m.title}
                    </span>
                    <span className="font-mono-code text-xs text-primary shrink-0">
                      {format(new Date(m.occurredAt), "EEE d MMM · HH:mm")}
                    </span>
                  </div>
                  {m.context && (
                    <p className="text-xs text-text-muted mt-0.5 truncate">with {m.context}</p>
                  )}
                  {m.description && (
                    <p className="text-xs text-text-secondary mt-1 line-clamp-2">{m.description}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </GlassCard>
      </div>
    </div>
  );
}

function clampInt(raw: string | undefined, min: number, max: number, fallback: number): number {
  const n = Number.parseInt(raw ?? "", 10);
  if (Number.isNaN(n) || n < min || n > max) return fallback;
  return n;
}
