import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { activities, contacts, leads, users } from "@/db/schema";
import { ActivityService } from "@/services/activity.service";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Brevo transactional webhook receiver (industry-grade: inbound email signal).
 *
 * Brevo POSTs event batches (open, click, hard_bounce, blocked, spam,
 * unsubscribed…). We resolve the recipient's contact → its lead(s) and append
 * a real EMAIL activity to the lead timeline, so the follow-up engine can see
 * engagement instead of blind-sending forever.
 *
 * Auth: shared-secret token in the query string (`?token=…`), compared in
 * constant time; the route is public in proxy.ts like /api/cron/tick. Always
 * returns 200 for valid tokens (Brevo retries on non-2xx) — failures are
 * logged, never thrown.
 */

// Brevo event names we translate; anything else is accepted but ignored.
const TRACKED_EVENTS = new Set(["opened", "click", "hard_bounce", "soft_bounce", "blocked", "spam", "unsubscribed"]);

const EVENT_TITLES: Record<string, string> = {
  opened: "Email opened",
  click: "Email link clicked",
  hard_bounce: "Email hard bounced",
  soft_bounce: "Email soft bounced",
  blocked: "Email blocked",
  spam: "Email marked as spam",
  unsubscribed: "Contact unsubscribed",
};

function timingSafeEqualStr(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

interface BrevoEvent {
  event?: string;
  email?: string;
  subject?: string;
  message_id?: string;
  ts?: number;
  ts_event?: number;
}

export async function POST(request: Request) {
  try {
    const url = new URL(request.url);
    const provided = url.searchParams.get("token") ?? "";
    const expected = process.env.BREVO_WEBHOOK_TOKEN ?? "";
    if (!expected || !timingSafeEqualStr(provided, expected)) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const body = (await request.json().catch(() => null)) as
      | { items?: BrevoEvent[]; event?: string; email?: string }
      | null;
    if (!body) return NextResponse.json({ success: true, processed: 0 });

    // Brevo sends either a single event or an array batch.
    const events: BrevoEvent[] = Array.isArray(body.items) ? body.items : [body as BrevoEvent];
    let processed = 0;

    // One system actor per workspace for attribution (activities.actor_id is
    // NOT NULL and references users).
    const [sysUser] = await db.select({ id: users.id }).from(users).where(eq(users.email, "system@aexyl.local")).limit(1);
    if (!sysUser) {
      logger.warn("brevo webhook: system actor missing", {});
      return NextResponse.json({ success: true, processed: 0, note: "system actor not provisioned" });
    }

    for (const ev of events) {
      try {
        const kind = ev.event ?? "";
        if (!TRACKED_EVENTS.has(kind) || !ev.email) continue;

        // Find the contact by email, then the open leads that reference it.
        const rows = await db
          .select({ leadId: leads.id, workspaceId: leads.workspaceId })
          .from(leads)
          .innerJoin(contacts, eq(contacts.id, leads.contactId))
          .where(and(eq(contacts.email, ev.email), sql`${leads.status} NOT IN ('CONVERTED', 'LOST')`))
          .limit(5);

        const ts = ev.ts_event || ev.ts;
        const occurredAt = ts ? new Date(ts * 1000) : new Date();
        for (const row of rows) {
          await ActivityService.createActivity(row.workspaceId, {
            workspaceId: row.workspaceId,
            leadId: row.leadId,
            dealId: null,
            contactId: null,
            actorId: sysUser.id,
            type: "EMAIL",
            title: EVENT_TITLES[kind] ?? `Email ${kind}`,
            description: ev.subject ? `Re: ${ev.subject}` : null,
            metadata: { via: "brevo_webhook", event: kind, messageId: ev.message_id ?? null, email: ev.email },
            occurredAt,
          } as typeof activities.$inferInsert);
          processed += 1;
        }
      } catch (e) {
        // One malformed event must not fail the batch.
        logger.warn("brevo webhook event failed", { error: e instanceof Error ? e.message : String(e) });
      }
    }

    return NextResponse.json({ success: true, processed });
  } catch (e) {
    logger.warn("brevo webhook failed", { error: e instanceof Error ? e.message : String(e) });
    // Fail-soft: 200 so Brevo doesn't retry-storm a broken endpoint.
    return NextResponse.json({ success: false });
  }
}
