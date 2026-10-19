import { sql } from "drizzle-orm";
import { db } from "@/db";

// shortcut: the team works in India, so "today" is IST; make it per-workspace if a team elsewhere joins.
export const TZ = "Asia/Kolkata";
/** Matches the Today list's 5 new gyms a day. */
export const DAILY_GOAL = 5;

export interface DayStat {
  day: string; // YYYY-MM-DD in IST
  contacted: number; // distinct gyms reached (outreach logged or outcome recorded)
  interested: number;
  notNow: number;
  notInterested: number;
  won: number;
  noAnswer: number;
}

const ymd = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(d);

/** Start of an IST calendar day as an absolute instant. */
export const istDayStart = (day: string) => new Date(`${day}T00:00:00+05:30`);

/** Last `days` IST dates, oldest first, ending today. */
export function lastDays(days: number, now = new Date()): string[] {
  const today = istDayStart(ymd(now));
  return Array.from({ length: days }, (_, i) => ymd(new Date(today.getTime() - (days - 1 - i) * 86_400_000 + 12 * 3_600_000)));
}

/**
 * Consecutive days (ending today) that hit the goal. Today only counts once it's hit,
 * so an unfinished today doesn't break yesterday's streak.
 */
export function computeStreak(stats: DayStat[], goal = DAILY_GOAL): number {
  let streak = 0;
  for (let i = stats.length - 1; i >= 0; i--) {
    if (stats[i].contacted >= goal) streak++;
    else if (i === stats.length - 1) continue;
    else break;
  }
  return streak;
}

export class ScorecardService {
  /** Gyms reached and tasks completed since `start` — the checked-off half of My Day's list. */
  static async getDoneSince(workspaceId: string, start: Date) {
    const [reached, tasksDone] = await Promise.all([
      db.execute(sql`
        select distinct on (a.lead_id) a.lead_id as id, c.name as title, a.title as note
        from activities a
        join leads l on l.id = a.lead_id
        join companies c on c.id = l.company_id
        where a.workspace_id = ${workspaceId}
          and a.occurred_at >= ${start.toISOString()}::timestamptz at time zone 'UTC'
          and (a.type = 'OUTREACH' or a.metadata->>'source' = 'lead_outcome')
        order by a.lead_id, a.occurred_at desc
      `) as unknown as Promise<{ id: string; title: string; note: string }[]>,
      db.execute(sql`
        select id, title from tasks
        where workspace_id = ${workspaceId} and status = 'DONE'
          and completed_at >= ${start.toISOString()}::timestamptz at time zone 'UTC'
      `) as unknown as Promise<{ id: string; title: string }[]>,
    ]);
    return { reached: [...reached], tasksDone: [...tasksDone] };
  }

  /** Per-day outreach numbers for the last `days` days (IST), every day present even with no activity. */
  static async getDailyStats(workspaceId: string, days = 60): Promise<DayStat[]> {
    const rows = (await db.execute(sql`
      select
        to_char((occurred_at at time zone 'UTC' at time zone ${TZ})::date, 'YYYY-MM-DD') as day,
        (count(distinct lead_id) filter (where type = 'OUTREACH' or metadata->>'source' = 'lead_outcome'))::int as contacted,
        (count(*) filter (where metadata->>'outcome' = 'INTERESTED'))::int as interested,
        (count(*) filter (where metadata->>'outcome' = 'NOT_NOW'))::int as "notNow",
        (count(*) filter (where metadata->>'outcome' = 'NOT_INTERESTED'))::int as "notInterested",
        (count(*) filter (where metadata->>'outcome' = 'WON'))::int as won,
        (count(*) filter (where type = 'OUTREACH' and description = 'No answer'))::int as "noAnswer"
      from activities
      where workspace_id = ${workspaceId}
        and occurred_at >= now() at time zone 'UTC' - make_interval(days => ${days})
      group by 1
    `)) as unknown as DayStat[];

    const byDay = new Map(rows.map((r) => [r.day, r]));
    return lastDays(days).map(
      (day) => byDay.get(day) ?? { day, contacted: 0, interested: 0, notNow: 0, notInterested: 0, won: 0, noAnswer: 0 },
    );
  }
}
