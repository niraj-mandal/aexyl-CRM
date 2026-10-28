/**
 * Call scoreboard: calls, pickups and outcomes over a period, by IST day and by city.
 * Built from what the CRM already logs: OUTREACH activities (each call / WhatsApp,
 * "No answer" in the description) and lead_outcome STAGE_CHANGE activities.
 */
import { and, eq, gte, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { activities, companies, discoveryCandidates, leads, users } from "@/db/schema";
import { leadCity } from "@/lib/maps";

const IST_MS = 330 * 60_000;
const DAY_MS = 86_400_000;
/** "2026-10-26" for the IST calendar day of a UTC timestamp. */
const istDay = (d: Date) => new Date(d.getTime() + IST_MS).toISOString().slice(0, 10);

export type Tally = { calls: number; connected: number; noAnswer: number; whatsapp: number; interested: number; notNow: number; notInterested: number; won: number };
const empty = (): Tally => ({ calls: 0, connected: 0, noAnswer: 0, whatsapp: 0, interested: 0, notNow: 0, notInterested: 0, won: 0 });

const OUTCOME_KEY: Record<string, keyof Tally> = { INTERESTED: "interested", NOT_NOW: "notNow", NOT_INTERESTED: "notInterested", WON: "won" };

export type ScoreEvent = { leadId: string; day: string; type: string; description: string | null; metadata: unknown };

/**
 * Totals for a set of events. A conversation is counted once per lead per day: a logged call
 * that wasn't "No answer", or an outcome recorded without a WhatsApp that day (in Call session
 * you call, then click Interested/Not now without ticking "Reached out" separately).
 */
export function tally(events: ScoreEvent[]): Tally {
  const t = empty();
  const day = new Map<string, { connected: boolean; outcome: boolean; whatsapp: boolean }>();
  for (const e of events) {
    const meta = (e.metadata ?? {}) as { channel?: string; outcome?: string };
    const key = `${e.leadId}|${e.day}`;
    const s = day.get(key) ?? { connected: false, outcome: false, whatsapp: false };
    day.set(key, s);
    if (e.type === "OUTREACH" && meta.channel === "CALL") {
      if (e.description?.trim().toLowerCase() === "no answer") {
        t.calls++;
        t.noAnswer++;
      } else s.connected = true;
    } else if (e.type === "OUTREACH" && meta.channel === "WHATSAPP") {
      t.whatsapp++;
      s.whatsapp = true;
    } else if (meta.outcome && OUTCOME_KEY[meta.outcome]) {
      t[OUTCOME_KEY[meta.outcome]]++;
      s.outcome = true;
    }
  }
  for (const s of day.values()) {
    if (s.connected || (s.outcome && !s.whatsapp)) {
      t.calls++;
      t.connected++;
    }
  }
  return t;
}

/**
 * Unticking "Reached out" logs a reach_toggle NOTE; it cancels that lead's latest call/WhatsApp
 * log before it. Events must be in time order; the NOTEs themselves are dropped.
 */
export function applyUnticks<E extends { leadId: string; type: string; metadata: unknown }>(events: E[]): E[] {
  const removed = new Set<number>();
  const lastOutreach = new Map<string, number[]>();
  events.forEach((e, i) => {
    if (e.type === "OUTREACH") lastOutreach.set(e.leadId, [...(lastOutreach.get(e.leadId) ?? []), i]);
    else if (e.type === "NOTE") {
      const prev = lastOutreach.get(e.leadId)?.pop();
      if (prev !== undefined) removed.add(prev);
    }
  });
  return events.filter((e, i) => e.type !== "NOTE" && !removed.has(i));
}

export class ScoreboardService {
  /** `actorId` limits to one person's own calls and outcomes (what a Sales member sees). */
  static async get(workspaceId: string, days: number, now = new Date(), actorId?: string) {
    // Start of the IST day `days - 1` days ago, so "7 days" is today plus the 6 before it.
    const todayStart = Date.parse(`${istDay(now)}T00:00:00Z`) - IST_MS;
    const since = new Date(todayStart - (days - 1) * DAY_MS);

    const rows = await db
      .select({
        type: activities.type,
        description: activities.description,
        metadata: activities.metadata,
        occurredAt: activities.occurredAt,
        source: leads.source,
        location: companies.location,
        candidateCity: discoveryCandidates.city,
        leadId: activities.leadId,
        actorId: activities.actorId,
        actorFirst: users.firstName,
        actorLast: users.lastName,
      })
      .from(activities)
      .innerJoin(leads, eq(leads.id, activities.leadId))
      .leftJoin(companies, eq(companies.id, leads.companyId))
      .leftJoin(users, eq(users.id, activities.actorId))
      .leftJoin(discoveryCandidates, and(eq(discoveryCandidates.leadId, leads.id), eq(discoveryCandidates.workspaceId, workspaceId)))
      .where(and(
        eq(activities.workspaceId, workspaceId),
        gte(activities.occurredAt, since),
        actorId ? eq(activities.actorId, actorId) : undefined,
        or(
          eq(activities.type, "OUTREACH"),
          and(eq(activities.type, "STAGE_CHANGE"), sql`${activities.metadata}->>'source' = 'lead_outcome'`),
          and(eq(activities.type, "NOTE"), sql`${activities.metadata}->>'source' = 'reach_toggle'`),
        ),
      ))
      .orderBy(activities.occurredAt);

    // A lead can match several discovery records; count each activity once.
    const seen = new Set<string>();
    const raw: (ScoreEvent & { city: string; person: string })[] = [];
    for (const r of rows) {
      const key = `${r.leadId}|${r.occurredAt.getTime()}|${r.type}`;
      if (seen.has(key) || !r.leadId) continue;
      seen.add(key);
      raw.push({ ...r, leadId: r.leadId, day: istDay(r.occurredAt), city: leadCity(r), person: [r.actorFirst, r.actorLast].filter(Boolean).join(" ") || "Unknown" });
    }
    const events = applyUnticks(raw);

    const dayKeys = Array.from({ length: days }, (_, i) => istDay(new Date(now.getTime() - (days - 1 - i) * DAY_MS)));
    const group = (key: (e: (typeof events)[number]) => string) => {
      const m = new Map<string, typeof events>();
      for (const e of events) m.set(key(e), [...(m.get(key(e)) ?? []), e]);
      return m;
    };
    const byDay = group((e) => e.day);
    const byCity = group((e) => e.city);
    const byPerson = group((e) => e.person);

    return {
      totals: tally(events),
      today: tally(byDay.get(istDay(now)) ?? []),
      daily: dayKeys.map((day) => ({ day, ...tally(byDay.get(day) ?? []) })),
      cities: [...byCity]
        .map(([city, evs]) => ({ city, ...tally(evs) }))
        .sort((a, b) => b.calls + b.whatsapp - (a.calls + a.whatsapp)),
      people: [...byPerson]
        .map(([person, evs]) => ({ person, ...tally(evs) }))
        .sort((a, b) => b.calls + b.whatsapp - (a.calls + a.whatsapp)),
    };
  }
}
