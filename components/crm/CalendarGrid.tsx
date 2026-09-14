"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CalendarEvent } from "@/services/calendar.service";

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

  const navigate = (delta: number) => {
    const d = new Date(year, month - 1 + delta, 1);
    const params = new URLSearchParams(searchParams.toString());
    params.set("y", String(d.getFullYear()));
    params.set("m", String(d.getMonth() + 1));
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
            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border-strong text-text-secondary hover:bg-surface-elevated transition"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <h2 className="text-lg font-semibold tracking-[-0.02em] text-text-primary min-w-[150px] text-center">
            {monthName} {year}
          </h2>
          <button
            onClick={() => navigate(1)}
            aria-label="Next month"
            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border-strong text-text-secondary hover:bg-surface-elevated transition"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>

        {/* Kind filters */}
        <div className="flex flex-wrap items-center gap-1.5">
          {KIND_ORDER.map((kind) => {
            const style = KIND_STYLES[kind];
            const active = !hidden.has(kind);
            const count = events.filter((e) => e.kind === kind).length;
            return (
              <button
                key={kind}
                onClick={() => toggleKind(kind)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition",
                  active
                    ? style.pill
                    : "border-border-subtle text-text-muted opacity-50 hover:opacity-80"
                )}
                title={active ? "Hide" : "Show"}
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
            className="text-center text-[10px] font-mono-code uppercase tracking-wider text-text-muted py-1"
          >
            {d}
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
          return (
            <div
              key={i}
              className={cn(
                "min-h-[84px] sm:min-h-[104px] rounded-lg border p-1.5 flex flex-col gap-1 transition",
                inMonth
                  ? "border-border-subtle/60 bg-surface-lowest/40"
                  : "border-transparent bg-transparent opacity-35",
                isToday && "border-primary/60 ring-1 ring-primary/40"
              )}
            >
              <div className="flex items-center justify-between">
                <span
                  className={cn(
                    "text-[11px] font-mono-code",
                    isToday ? "text-primary font-semibold" : isPast ? "text-text-muted" : "text-text-secondary"
                  )}
                >
                  {date.getDate()}
                </span>
                {isToday && (
                  <span className="text-[9px] font-mono-code uppercase text-primary">today</span>
                )}
              </div>
              <div className="flex flex-col gap-0.5 overflow-hidden">
                {dayEvents.slice(0, 3).map((e) => {
                  const style = KIND_STYLES[e.kind];
                  const time = new Date(e.when);
                  return (
                    <Link
                      key={e.id}
                      href={e.href ?? "#"}
                      title={`${e.title}${e.context ? ` · ${e.context}` : ""}`}
                      className={cn(
                        "truncate rounded border px-1.5 py-0.5 text-[10px] leading-tight transition hover:opacity-80",
                        style.pill
                      )}
                    >
                      {e.allDay ? "" : `${time.getHours().toString().padStart(2, "0")}:${time.getMinutes().toString().padStart(2, "0")} `}
                      {e.title}
                    </Link>
                  );
                })}
                {dayEvents.length > 3 && (
                  <span className="text-[9px] font-mono-code text-text-muted pl-1">
                    +{dayEvents.length - 3} more
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
