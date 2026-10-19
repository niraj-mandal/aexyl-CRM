import { NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "node:crypto";
import { and, eq, gte, inArray, isNotNull, lt, lte, notInArray, or } from "drizzle-orm";
import { db } from "@/db";
import { agentEvents, leads, projects, users, workspaces } from "@/db/schema";
import { logger } from "@/lib/logger";
import { captureError } from "@/lib/observability";
import { AgentEventBus, type AexylEventType } from "@/agents/events/bus";
import {
  claimRetryingRuns,
  detectFailureSpikes,
  reapStaleRuns,
} from "@/agents/core/runtime/reaper";
import { ensureWorkspaceAgents } from "@/agents/registry";
import { DiscoveryOrchestrator } from "@/services/discovery/orchestrator";

export const dynamic = "force-dynamic";
// Agent runs call the AI planner; a batch of them needs more than the default time limit.
export const maxDuration = 300;

/**
 * Cron tick — the scheduler entry point for time-based automation. Scheduled
 * daily by Vercel Cron (vercel.json) and optionally every 15 minutes by the
 * Railway cron service (see `cron/`), both with
 * `Authorization: Bearer ${CRON_SECRET}`; exempted from Clerk in `proxy.ts`
 * because the caller is a machine, not a session.
 *
 * Per workspace (each isolated in try/catch — one workspace's failure never
 * blocks the others):
 *   1. publish `lead.followup_due`, `lead.stale` and `project.at_risk` events
 *      (`lead.created` is published when a lead is created, in CrmService)
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
// An agent run takes ~45 s (AI planning); 5 per tick stays inside the 300 s limit. Leftovers carry to the next tick.
const EVENT_BATCH_SIZE = 5;
/** A hot lead with no contact for this long fires `lead.stale` (at most once per this window). */
const STALE_AFTER_DAYS = 7;

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
 * Publish one event per entity, skipping entities that already got this event
 * within `windowHours` (pending or processed). The bus consumes each event once
 * downstream; re-publishing sooner would only fight the rules' cooldowns.
 */
async function publishOnce(
  workspaceId: string,
  eventType: AexylEventType,
  entityType: string,
  windowHours: number,
  items: { id: string; payload: Record<string, unknown> }[],
): Promise<number> {
  if (items.length === 0) return 0;
  const recent = await db
    .select({ entityId: agentEvents.entityId })
    .from(agentEvents)
    .where(
      and(
        eq(agentEvents.workspaceId, workspaceId),
        eq(agentEvents.eventType, eventType),
        gte(agentEvents.createdAt, new Date(Date.now() - windowHours * 3600 * 1000)),
      ),
    );
  const seen = new Set(recent.map((r) => r.entityId));
  let published = 0;
  for (const item of items) {
    if (seen.has(item.id)) continue;
    await AgentEventBus.publish({ workspaceId, eventType, entityType, entityId: item.id, payload: { ...item.payload, source: "cron" } });
    published += 1;
  }
  return published;
}

/** Leads whose follow-up date has passed (excluding closed outcomes). */
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
  return publishOnce(workspaceId, "lead.followup_due", "lead", FOLLOWUP_EVENT_WINDOW_HOURS,
    due.map((l) => ({ id: l.id, payload: { leadId: l.id, temperature: l.temperature } })));
}

/**
 * Hot leads you HAVE talked to that went quiet for 7+ days. Never-contacted leads
 * are excluded on purpose: they're new, not stale, and already sit in the Today list.
 */
async function publishStaleHotLeads(workspaceId: string): Promise<number> {
  const stale = await db
    .select({ id: leads.id, temperature: leads.temperature })
    .from(leads)
    .where(
      and(
        eq(leads.workspaceId, workspaceId),
        eq(leads.temperature, "HOT"),
        isNotNull(leads.lastContactedAt),
        lt(leads.lastContactedAt, new Date(Date.now() - STALE_AFTER_DAYS * 86_400_000)),
        notInArray(leads.status, ["CONVERTED", "LOST", "UNQUALIFIED"]),
      ),
    )
    .limit(FOLLOWUP_SCAN_LIMIT);
  return publishOnce(workspaceId, "lead.stale", "lead", STALE_AFTER_DAYS * 24,
    stale.map((l) => ({ id: l.id, payload: { leadId: l.id, temperature: l.temperature } })));
}

/** Active projects marked at risk / off track, or past their due date. */
async function publishAtRiskProjects(workspaceId: string): Promise<number> {
  const atRisk = await db
    .select({ id: projects.id, health: projects.health })
    .from(projects)
    .where(
      and(
        eq(projects.workspaceId, workspaceId),
        notInArray(projects.status, ["DELIVERED", "CANCELLED"]),
        or(inArray(projects.health, ["AT_RISK", "OFF_TRACK"]), lt(projects.dueDate, new Date())),
      ),
    )
    .limit(FOLLOWUP_SCAN_LIMIT);
  return publishOnce(workspaceId, "project.at_risk", "project", 24,
    atRisk.map((p) => ({ id: p.id, payload: { projectId: p.id, health: p.health } })));
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
  let eventsPublished = 0;
  let discoveryRuns = 0;

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
        eventsPublished += await publishDueFollowUps(ws.id);
        eventsPublished += await publishStaleHotLeads(ws.id);
        eventsPublished += await publishAtRiskProjects(ws.id);

        const results = await AgentEventBus.processPending(ws.id, systemUserId, EVENT_BATCH_SIZE);
        eventsProcessed += results.length;

        await claimRetryingRuns(ws.id);
        await reapStaleRuns(ws.id);
        await detectFailureSpikes(ws.id);

        // Daily discovery — idempotent, skips if already ran today
        try {
          const dr = await DiscoveryOrchestrator.runDaily(ws.id, systemUserId);
          if (dr.status !== "SKIPPED") discoveryRuns++;
        } catch (dErr) {
          logger.error("cron tick discovery failed", { workspaceId: ws.id, error: dErr instanceof Error ? dErr.message : String(dErr) });
        }

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
    eventsPublished,
    discoveryRuns,
    errors,
    durationMs: Date.now() - startedAt,
    time: new Date().toISOString(),
  };
  // 200 when at least one workspace completed (partial errors are reported in
  // the body for monitoring); 500 only when nothing could be processed.
  return NextResponse.json(body, { status: workspacesProcessed > 0 ? 200 : 500 });
}
