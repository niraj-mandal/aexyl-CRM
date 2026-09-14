import { requireWorkspace } from "@/lib/auth/workspace";
import { CalendarService } from "@/services/calendar.service";
import { CalendarGrid } from "@/components/crm/CalendarGrid";
import { ScheduleMeetingButton } from "@/components/crm/ScheduleMeetingButton";
import { GlassCard } from "@/components/ui/glass-card";
import { Display, PageTitle, Body, MonoLabel } from "@/components/ui/typography";
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
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700 ease-out">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-border-subtle/50">
        <div>
          <MonoLabel className="text-primary block mb-1">OPERATIONS // TIME</MonoLabel>
          <Display>Calendar</Display>
          <Body className="mt-2">
            Every dated commitment in the workspace — meetings, task deadlines, deal
            close dates, follow-ups, and project due dates — straight from the database.
          </Body>
        </div>
        <ScheduleMeetingButton />
      </div>

      <CalendarGrid
        year={year}
        month={month}
        events={events}
        monthName={MONTH_NAMES[month - 1]}
      />

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Month agenda */}
        <GlassCard>
          <div className="flex items-center justify-between mb-4">
            <PageTitle>{MONTH_NAMES[month - 1]} agenda</PageTitle>
            <Badge variant="outline" className="font-mono-code text-[11px]">
              {events.length} items
            </Badge>
          </div>
          {events.length === 0 ? (
            <Body>
              Nothing scheduled this month yet. Use “Schedule meeting” to add your first
              commitment — it will appear here and on the grid.
            </Body>
          ) : (
            <div className="space-y-4 max-h-[420px] overflow-y-auto pr-1">
              {Array.from(agendaByDay.entries()).map(([day, dayEvents]) => (
                <div key={day}>
                  <MonoLabel className="text-text-muted mb-1.5 block">
                    {format(new Date(day), "EEE d MMM yyyy")}
                  </MonoLabel>
                  <div className="space-y-1.5">
                    {dayEvents.map((e) => (
                      <Link
                        key={e.id}
                        href={e.href ?? "#"}
                        className="flex items-center gap-3 rounded-lg border border-border-subtle/60 bg-surface-lowest/40 px-3 py-2 hover:bg-surface-elevated/60 transition group"
                      >
                        <span className="font-mono-code text-[11px] text-text-muted w-12 shrink-0">
                          {e.allDay
                            ? "all-day"
                            : format(new Date(e.when), "HH:mm")}
                        </span>
                        <span className="flex-1 truncate text-sm text-text-primary group-hover:text-primary transition">
                          {e.title}
                        </span>
                        <Badge variant="secondary" className="font-mono-code text-[10px] shrink-0">
                          {KIND_LABEL[e.kind] ?? e.kind}
                        </Badge>
                      </Link>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </GlassCard>

        {/* Upcoming meetings rail */}
        <GlassCard>
          <div className="flex items-center justify-between mb-4">
            <PageTitle>Upcoming meetings</PageTitle>
            <Badge variant="secondary" className="font-mono-code text-[11px]">
              {counts.MEETING} this month
            </Badge>
          </div>
          {upcomingMeetings.length === 0 ? (
            <Body>
              No meetings on the books. Scheduled meetings persist as real MEETING
              activities — they also appear on lead and deal timelines.
            </Body>
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
                    <span className="font-mono-code text-[11px] text-primary shrink-0">
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
