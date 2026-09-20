import { NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "node:crypto";
import { and, eq, gte, isNotNull, lte, notInArray } from "drizzle-orm";
import { db } from "@/db";
import { agentEvents, leads, users, workspaces } from "@/db/schema";
import { logger } from "@/lib/logger";
import { captureError } from "@/lib/observability";
import { AgentEventBus } from "@/agents/events/bus";
import {
  claimRetryingRuns,
  detectFailureSpikes,
  reapStaleRuns,
} from "@/agents/core/runtime/reaper";
import { ensureWorkspaceAgents } from "@/agents/registry";

export const dynamic = "force-dynamic";

/**
 * Cron tick — the scheduler entry point for time-based automation. Invoked
 * every 15 minutes by the Railway cron service (see `cron/`) with
 * `Authorization: Bearer ${CRON_SECRET}`; exempted from Clerk in `proxy.ts`
 * because the caller is a machine, not a session.
 *
 * Per workspace (each isolated in try/catch — one workspace's failure never
 * blocks the others):
 *   1. publish `lead.followup_due` events for due follow-ups
 *   2. AgentEventBus.processPending  → events become agent runs (cooldown,
 *      idempotency, and policy checks all live inside the bus/runtime)
 *   3. claimRetryingRuns             → pick up runs the reaper queued
 *   4. reapStaleRuns                 → no run is left stuck in RUNNING
 *   5. detectFailureSpikes           → auto-open incidents on failure spikes
 *
 * Idempotent and safe at any cadence: the bus applies per-rule cooldowns and
 * trigger-based dedupe, the reaper only touches over-age RUNNING runs, and
 * this route refuses to double-publish a follow-up that is still queued.
 * No business logic lives here — orchestration only.
 */

/** Re-publish window: a due follow-up fires at most once per 6 hours. */
const FOLLOWUP_EVENT_WINDOW_HOURS = 6;
const SYSTEM_CLERK_ID = "system-cron";
const FOLLOWUP_SCAN_LIMIT = 50;
const EVENT_BATCH_SIZE = 10;

/** Length-safe equality: compare SHA-256 digests, never the raw strings. */
function bearerMatches(provided: string, secret: string): boolean {
  const a = createHash("sha256").update(provided).digest();
  const b = createHash("sha256").update(secret).digest();
  return timingSafeEqual(a, b);
}

/**
 * Resolve the synthetic system actor that attributes cron-triggered work in
 * audit logs and agent runs (actor_id is a NOT NULL FK to users). Same
 * "link-or-create synthetic identity" pattern as db/seed.ts's seeded operator.
 */
async function getSystemUserId(): Promise<string> {
  const existing = await db.query.users.findFirst({
    where: eq(users.clerkId, SYSTEM_CLERK_ID),
  });
  if (existing) return existing.id;

  await db
    .insert(users)
    .values({
      clerkId: SYSTEM_CLERK_ID,
      email: "system@aexyl.local",
      firstName: "Aexyl",
      lastName: "System",
    })
    .onConflictDoNothing();

  const [row] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.clerkId, SYSTEM_CLERK_ID))
    .limit(1);
  return row.id;
}

/**
 * Publish `lead.followup_due` for every lead whose follow-up date has passed
 * (excluding closed outcomes). A lead with an event already PENDING is
 * skipped — the bus consumes each event exactly once downstream, so
 * re-publishing would only fight the rules' cooldowns.
 */
async function publishDueFollowUps(workspaceId: string): Promise<number> {
  const due = await db
    .select({ id: leads.id, temperature: leads.temperature })
    .from(leads)
    .where(
      and(
        eq(leads.workspaceId, workspaceId),
        isNotNull(leads.nextFollowUpAt),
        lte(leads.nextFollowUpAt, new Date()),
        notInArray(leads.status, ["CONVERTED", "LOST"]),
      ),
    )
    .limit(FOLLOWUP_SCAN_LIMIT);
  if (due.length === 0) return 0;

  const pendingOrRecent = await db
    .select({ entityId: agentEvents.entityId })
    .from(agentEvents)
    .where(
      and(
        eq(agentEvents.workspaceId, workspaceId),
        eq(agentEvents.eventType, "lead.followup_due"),
        gte(
          agentEvents.createdAt,
          new Date(Date.now() - FOLLOWUP_EVENT_WINDOW_HOURS * 3600 * 1000),
        ),
      ),
    );
  const queued = new Set(pendingOrRecent.map((p) => p.entityId));

  let published = 0;
  for (const lead of due) {
    if (queued.has(lead.id)) continue;
    await AgentEventBus.publish({
      workspaceId,
      eventType: "lead.followup_due",
      entityType: "lead",
      entityId: lead.id,
      payload: { leadId: lead.id, temperature: lead.temperature, source: "cron" },
    });
    published += 1;
  }
  return published;
}

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const provided = req.headers.get("authorization");
  const token = provided?.startsWith("Bearer ") ? provided.slice(7) : null;

  if (!secret || !token || !bearerMatches(token, secret)) {
    if (!secret) {
      logger.error("cron tick rejected: CRON_SECRET is not configured");
    }
    logger.warn("cron tick unauthorized", {
      secretConfigured: Boolean(secret),
      hasAuthHeader: Boolean(provided),
    });
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startedAt = Date.now();
  const errors: string[] = [];
  let workspacesProcessed = 0;
  let eventsProcessed = 0;
  let followupsPublished = 0;

  try {
    const systemUserId = await getSystemUserId();
    const allWorkspaces = await db.select({ id: workspaces.id }).from(workspaces);

    for (const ws of allWorkspaces) {
      try {
        // Ensure agents + default automation rules exist even with zero UI
        // activity (first tick to see this workspace, or a workspace created
        // after the followup_due rule shipped). Idempotent per workspace.
        await ensureWorkspaceAgents(ws.id);

        // Follow-ups are published BEFORE processPending so a due follow-up
        // becomes an agent run within this same tick, not the next one.
        followupsPublished += await publishDueFollowUps(ws.id);

        const results = await AgentEventBus.processPending(ws.id, systemUserId, EVENT_BATCH_SIZE);
        eventsProcessed += results.length;

        await claimRetryingRuns(ws.id);
        await reapStaleRuns(ws.id);
        await detectFailureSpikes(ws.id);

        workspacesProcessed += 1;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`${ws.id}: ${msg}`);
        logger.error("cron tick workspace failed", { workspaceId: ws.id, error: msg });
        await captureError(err, { scope: "cron.tick.workspace", workspaceId: ws.id });
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    errors.push(`fatal: ${msg}`);
    logger.error("cron tick fatal", { error: msg });
    await captureError(err, { scope: "cron.tick.fatal" });
  }

  const body = {
    ok: errors.length === 0,
    workspacesProcessed,
    eventsProcessed,
    followupsPublished,
    errors,
    durationMs: Date.now() - startedAt,
    time: new Date().toISOString(),
  };
  // 200 when at least one workspace completed (partial errors are reported in
  // the body for monitoring); 500 only when nothing could be processed.
  return NextResponse.json(body, { status: workspacesProcessed > 0 ? 200 : 500 });
}
