"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CalendarEvent } from "@/services/calendar.service";
import { EventContextMenu } from "@/components/crm/EventContextMenu";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const KIND_STYLES: Record<
  CalendarEvent["kind"],
  { dot: string; pill: string; label: string }
> = {
  MEETING: {
    dot: "bg-primary",
    pill: "border-primary/40 bg-primary/10 text-text-primary",
    label: "Meeting",
  },
  TASK: {
    dot: "bg-amber-400",
    pill: "border-amber-400/30 bg-amber-400/10 text-amber-200",
    label: "Task due",
  },
  DEAL_CLOSE: {
    dot: "bg-emerald-400",
    pill: "border-emerald-400/30 bg-emerald-400/10 text-emerald-200",
    label: "Deal close",
  },
  FOLLOW_UP: {
    dot: "bg-sky-400",
    pill: "border-sky-400/30 bg-sky-400/10 text-sky-200",
    label: "Follow-up",
  },
  PROJECT_DUE: {
    dot: "bg-fuchsia-400",
    pill: "border-fuchsia-400/30 bg-fuchsia-400/10 text-fuchsia-200",
    label: "Project due",
  },
};

const KIND_ORDER: Array<CalendarEvent["kind"]> = [
  "MEETING",
  "TASK",
  "DEAL_CLOSE",
  "FOLLOW_UP",
  "PROJECT_DUE",
];

function localDayKey(iso: string): string {
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function CalendarGrid({
  year,
  month,
  events,
  monthName,
}: {
  year: number;
  month: number;
  events: CalendarEvent[];
  monthName: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [hidden, setHidden] = useState<Set<CalendarEvent["kind"]>>(new Set());

  const visible = useMemo(
    () => events.filter((e) => !hidden.has(e.kind)),
    [events, hidden]
  );

  const byDay = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const e of visible) {
      const key = localDayKey(e.when);
      const list = map.get(key);
      if (list) list.push(e);
      else map.set(key, [e]);
    }
    return map;
  }, [visible]);

  // Monday-first grid covering all days that touch the target month.
  const cells = useMemo(() => {
    const first = new Date(year, month - 1, 1);
    const daysInMonth = new Date(year, month, 0).getDate();
    const leading = (first.getDay() + 6) % 7; // Monday=0
    const total = Math.ceil((leading + daysInMonth) / 7) * 7;
    const out: Array<{ date: Date; inMonth: boolean }> = [];
    for (let i = 0; i < total; i++) {
      const date = new Date(year, month - 1, 1 - leading + i);
      out.push({ date, inMonth: date.getMonth() === month - 1 });
    }
    return out;
  }, [year, month]);

  const todayKey = localDayKey(new Date().toISOString());
  // Phones show dots in the grid and the tapped day's events as a list below it.
  const [picked, setPicked] = useState<string | null>(null);
  const inThisMonth = todayKey.startsWith(`${year}-${String(month).padStart(2, "0")}`);
  const selectedKey = picked ?? (inThisMonth ? todayKey : localDayKey(new Date(year, month - 1, 1).toISOString()));
  const selectedEvents = byDay.get(selectedKey) ?? [];
  const hhmm = (iso: string) => {
    const t = new Date(iso);
    return `${t.getHours().toString().padStart(2, "0")}:${t.getMinutes().toString().padStart(2, "0")}`;
  };

  const navigate = (delta: number) => {
    const d = new Date(year, month - 1 + delta, 1);
    const params = new URLSearchParams(searchParams.toString());
    params.set("y", String(d.getFullYear()));
    params.set("m", String(d.getMonth() + 1));
    setPicked(null);
    router.push(`${pathname}?${params.toString()}`);
  };

  const toggleKind = (kind: CalendarEvent["kind"]) => {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(kind)) next.delete(kind);
      else next.add(kind);
      return next;
    });
  };

  const now = new Date();

  return (
    <div className="glass rounded-xl p-4 sm:p-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          <button
            onClick={() => navigate(-1)}
            aria-label="Previous month"
            className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-border-strong text-text-secondary hover:bg-surface-elevated transition sm:h-8 sm:w-8"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <h2 className="text-lg font-semibold tracking-[-0.02em] text-text-primary min-w-[140px] text-center">
            {monthName} {year}
          </h2>
          <button
            onClick={() => navigate(1)}
            aria-label="Next month"
            className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-border-strong text-text-secondary hover:bg-surface-elevated transition sm:h-8 sm:w-8"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>

        {/* Kind filters */}
        <div className="-mx-4 flex w-[calc(100%+2rem)] items-center gap-1.5 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:w-auto sm:flex-wrap sm:overflow-visible sm:px-0 sm:pb-0">
          {KIND_ORDER.map((kind) => {
            const style = KIND_STYLES[kind];
            const active = !hidden.has(kind);
            const count = events.filter((e) => e.kind === kind).length;
            return (
              <button
                key={kind}
                onClick={() => toggleKind(kind)}
                className={cn(
                  "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition max-sm:min-h-9",
                  active
                    ? style.pill
                    : "border-border-subtle text-text-muted opacity-50 hover:opacity-80"
                )}
                title={active ? "Hide" : "Show"}
                aria-pressed={active}
              >
                <span className={cn("h-1.5 w-1.5 rounded-full", active ? style.dot : "bg-text-muted")} />
                {style.label}
                <span className="text-text-muted">{count}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Weekday header */}
      <div className="grid grid-cols-7 mb-1.5">
        {WEEKDAYS.map((d) => (
          <div
            key={d}
            className="text-center text-xs font-mono-code uppercase tracking-wider text-text-muted py-1"
          >
            <span className="sm:hidden">{d[0]}</span>
            <span className="max-sm:hidden">{d}</span>
          </div>
        ))}
      </div>

      {/* Day grid */}
      <div className="grid grid-cols-7 gap-1 sm:gap-1.5">
        {cells.map(({ date, inMonth }, i) => {
          const key = localDayKey(date.toISOString());
          const dayEvents = byDay.get(key) ?? [];
          const isToday = key === todayKey;
          const isPast = date < new Date(now.getFullYear(), now.getMonth(), now.getDate());
          const isSelected = key === selectedKey;
          return (
            <div
              key={i}
              className={cn(
                "relative min-h-[52px] sm:min-h-[124px] rounded-lg border p-1.5 flex flex-col gap-1 transition",
                isSelected && "max-sm:bg-primary/15 max-sm:border-primary/50",
                inMonth
                  ? "border-border-subtle/60 bg-surface-lowest/40"
                  : "border-transparent bg-transparent opacity-35",
                isToday && "border-primary/60 ring-1 ring-primary/40"
              )}
            >
              <div className="flex items-center justify-between">
                {/* On phones the whole cell is this button (after:inset-0): tap a day to list its events. */}
                <button
                  type="button"
                  onClick={() => setPicked(key)}
                  aria-label={`${date.toDateString()}, ${dayEvents.length} event${dayEvents.length === 1 ? "" : "s"}`}
                  aria-pressed={isSelected}
                  className={cn(
                    "text-xs font-mono-code max-sm:after:absolute max-sm:after:inset-0 sm:cursor-default",
                    isToday ? "text-primary font-semibold" : isPast ? "text-text-muted" : "text-text-secondary"
                  )}
                >
                  {date.getDate()}
                </button>
                {isToday && (
                  <span className="text-[11px] font-mono-code uppercase text-primary max-sm:hidden">today</span>
                )}
              </div>
              {/* Phone: one dot per kind of event that day. */}
              {dayEvents.length > 0 && (
                <div className="mt-auto flex flex-wrap gap-0.5 sm:hidden" aria-hidden>
                  {KIND_ORDER.filter((k) => dayEvents.some((e) => e.kind === k)).map((k) => (
                    <span key={k} className={cn("h-1.5 w-1.5 rounded-full", KIND_STYLES[k].dot)} />
                  ))}
                </div>
              )}
              <div className="hidden flex-col gap-0.5 overflow-hidden sm:flex">
                {dayEvents.slice(0, 3).map((e) => {
                  const style = KIND_STYLES[e.kind];
                  const time = new Date(e.when);
                  return (
                    <EventContextMenu key={e.id} event={e}>
                      <Link
                      href={e.href ?? "#"}
                      title={`${e.title}${e.context ? ` — ${e.context}` : ""}`}
                      className={cn(
                        "block rounded border px-1.5 py-0.5 text-xs leading-tight transition hover:opacity-80",
                        style.pill
                      )}
                    >
                      {/* Line 1 (bold): time + WHOSE event — the key info in a narrow cell. */}
                      <span className="block truncate font-medium">
                        {e.allDay ? "" : `${time.getHours().toString().padStart(2, "0")}:${time.getMinutes().toString().padStart(2, "0")} `}
                        {e.context ?? e.title}
                      </span>
                      {/* Line 2 (dim): what it is — only when the first line already told who. */}
                      {e.context && (
                        <span className="block truncate text-[11px] opacity-70">
                          {e.title}
                        </span>
                      )}
                      </Link>
                    </EventContextMenu>
                  );
                })}
                {dayEvents.length > 3 && (
                  <span className="text-[11px] font-mono-code text-text-muted pl-1">
                    +{dayEvents.length - 3} more
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Phone agenda for the selected day */}
      <section aria-label="Events on the selected day" className="mt-4 sm:hidden">
        <h3 className="mb-2 text-sm font-semibold text-text-primary">
          {selectedKey === todayKey ? "Today" : new Date(`${selectedKey}T12:00:00`).toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "short" })}
          <span className="ml-2 text-xs font-normal text-text-muted">{selectedEvents.length} event{selectedEvents.length === 1 ? "" : "s"}</span>
        </h3>
        {selectedEvents.length === 0 ? (
          <p className="rounded-lg bg-surface-lowest/40 px-3 py-4 text-center text-xs text-text-muted">Nothing on this day.</p>
        ) : (
          <ul className="divide-y divide-border-subtle overflow-hidden rounded-lg bg-surface-lowest/40">
            {selectedEvents.map((e) => (
              <li key={e.id}>
                <Link href={e.href ?? "#"} className="flex min-h-12 items-center gap-3 px-3 py-2.5 active:bg-[var(--fill-hover)]">
                  <span className={cn("h-2 w-2 shrink-0 rounded-full", KIND_STYLES[e.kind].dot)} aria-hidden />
                  <span className="num w-11 shrink-0 text-xs text-text-muted">{e.allDay ? "All day" : hhmm(e.when)}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-text-primary">{e.context ?? e.title}</span>
                    <span className="block truncate text-xs text-text-muted">
                      {KIND_STYLES[e.kind].label}
                      {e.context ? ` · ${e.title}` : ""}
                    </span>
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-text-muted" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
