/**
 * Call scoreboard: calls, pickups and outcomes over a period, by IST day and by city.
 * Built from what the CRM already logs: OUTREACH activities (each call / WhatsApp,
 * "No answer" in the description) and lead_outcome STAGE_CHANGE activities.
 */
import { and, eq, gte, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { activities, companies, discoveryCandidates, leads } from "@/db/schema";
import { leadCity } from "@/lib/maps";

const IST_MS = 330 * 60_000;
const DAY_MS = 86_400_000;
/** "2026-10-26" for the IST calendar day of a UTC timestamp. */
const istDay = (d: Date) => new Date(d.getTime() + IST_MS).toISOString().slice(0, 10);

export type Tally = { calls: number; connected: number; noAnswer: number; whatsapp: number; interested: number; notNow: number; notInterested: number; won: number };
const empty = (): Tally => ({ calls: 0, connected: 0, noAnswer: 0, whatsapp: 0, interested: 0, notNow: 0, notInterested: 0, won: 0 });

const OUTCOME_KEY: Record<string, keyof Tally> = { INTERESTED: "interested", NOT_NOW: "notNow", NOT_INTERESTED: "notInterested", WON: "won" };

export function tally(t: Tally, row: { type: string; description: string | null; metadata: unknown }) {
  const meta = (row.metadata ?? {}) as { channel?: string; outcome?: string };
  if (row.type === "OUTREACH") {
    if (meta.channel === "CALL") {
      t.calls++;
      if (row.description?.trim().toLowerCase() === "no answer") t.noAnswer++;
      else t.connected++;
    } else if (meta.channel === "WHATSAPP") t.whatsapp++;
  } else if (meta.outcome && OUTCOME_KEY[meta.outcome]) t[OUTCOME_KEY[meta.outcome]]++;
}

export class ScoreboardService {
  static async get(workspaceId: string, days: number, now = new Date()) {
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
      })
      .from(activities)
      .innerJoin(leads, eq(leads.id, activities.leadId))
      .leftJoin(companies, eq(companies.id, leads.companyId))
      .leftJoin(discoveryCandidates, and(eq(discoveryCandidates.leadId, leads.id), eq(discoveryCandidates.workspaceId, workspaceId)))
      .where(and(
        eq(activities.workspaceId, workspaceId),
        gte(activities.occurredAt, since),
        or(eq(activities.type, "OUTREACH"), and(eq(activities.type, "STAGE_CHANGE"), sql`${activities.metadata}->>'source' = 'lead_outcome'`)),
      ));

    const totals = empty();
    const byDay = new Map<string, Tally>();
    for (let i = days - 1; i >= 0; i--) byDay.set(istDay(new Date(now.getTime() - i * DAY_MS)), empty());
    const byCity = new Map<string, Tally>();
    const today = byDay.get(istDay(now))!;

    // A lead can match several discovery records; count each activity once.
    const seen = new Set<string>();
    for (const r of rows) {
      const key = `${r.leadId}|${r.occurredAt.getTime()}|${r.type}`;
      if (seen.has(key)) continue;
      seen.add(key);
      tally(totals, r);
      const day = byDay.get(istDay(r.occurredAt));
      if (day) tally(day, r);
      const city = leadCity(r);
      if (!byCity.has(city)) byCity.set(city, empty());
      tally(byCity.get(city)!, r);
    }

    return {
      totals,
      today,
      daily: [...byDay].map(([day, t]) => ({ day, ...t })),
      cities: [...byCity]
        .map(([city, t]) => ({ city, ...t }))
        .sort((a, b) => b.calls + b.whatsapp - (a.calls + a.whatsapp)),
    };
  }
}
