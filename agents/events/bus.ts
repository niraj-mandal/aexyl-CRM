/**
 * Agent Event Bus — closed-loop wiring between domain activity and agents.
 *
 * Domain code publishes events (e.g. lead.created); the bus records them in
 * agent_events and matches workspace automation_rules. Processing is
 * pull-based (called from server actions / cron entry points) — no browser
 * dependency, no long-lived workers in dev.
 *
 * Guarantees: cooldown per rule, idempotency per (rule, entity, window),
 * policy-checked starts (blocked events are marked SKIPPED, not lost).
 */
import { db } from "@/db";
import { agentEvents, automationRules, agentRuns, agents } from "@/db/schema";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { AgentRunnerService } from "../services/runner.service";
import { requireWorkspace } from "@/lib/auth/workspace";
import { ActivityService } from "@/services/activity.service";

export type AexylEventType =
  | "lead.created"
  | "lead.stale"
  | "lead.followup_due"
  | "deal.high_value"
  | "deal.stalled"
  | "project.at_risk"
  | "task.overdue"
  | "milestone.delayed";

export class AgentEventBus {
  /** Records a domain event. Fire-and-forget safe (never throws). */
  static async publish(params: {
    workspaceId: string;
    eventType: AexylEventType;
    entityType?: string;
    entityId?: string;
    payload?: Record<string, unknown>;
  }) {
    try {
      await db.insert(agentEvents).values({
        workspaceId: params.workspaceId,
        eventType: params.eventType,
        entityType: params.entityId && params.entityType ? params.entityType : null,
        entityId: params.entityId ?? null,
        payload: params.payload ?? null,
        status: "PENDING",
      });
    } catch {
      // Event persistence must never break the triggering domain action.
    }
  }

  /**
   * Processes pending events for the current workspace against enabled
   * automation rules. Called opportunistically (dashboard load, explicit
   * "Process events" action) — bounded to a small batch per call.
   */
  static async processPending(workspaceId: string, userId: string, batchSize = 5) {
    const events = await db
      .select()
      .from(agentEvents)
      .where(and(eq(agentEvents.workspaceId, workspaceId), eq(agentEvents.status, "PENDING")))
      .orderBy(desc(agentEvents.createdAt))
      .limit(batchSize);

    const results: { eventId: string; eventType: string; outcome: string }[] = [];

    for (const event of events) {
      const rules = await db
        .select()
        .from(automationRules)
        .where(
          and(
            eq(automationRules.workspaceId, workspaceId),
            eq(automationRules.eventType, event.eventType),
            eq(automationRules.enabled, true)
          )
        );

      if (rules.length === 0) {
        await db.update(agentEvents).set({ status: "SKIPPED", processedAt: new Date(), error: "no matching rule" }).where(eq(agentEvents.id, event.id));
        results.push({ eventId: event.id, eventType: event.eventType, outcome: "SKIPPED_NO_RULE" });
        continue;
      }

      let anyStarted = false;
      for (const rule of rules) {
        // Cooldown: has this rule produced a run for this entity recently?
        const cooldownCutoff = new Date(Date.now() - rule.cooldownSeconds * 1000);
        const recent = await db
          .select({ n: sql<number>`count(*)::int` })
          .from(agentRuns)
          .where(
            and(
              eq(agentRuns.workspaceId, workspaceId),
              eq(agentRuns.agentId, rule.agentId),
              gte(agentRuns.createdAt, cooldownCutoff),
              sql`${agentRuns.triggerId} = ${`${rule.id}:${event.entityId ?? event.id}`}`
            )
          );
        if ((recent[0]?.n ?? 0) > 0) {
          continue;
        }

        // Conditions: simple equality filters against payload, e.g. {"temperature":"HOT"}
        const conditions = (rule.conditions ?? {}) as Record<string, unknown>;
        const payload = (event.payload ?? {}) as Record<string, unknown>;
        const conditionsMet = Object.entries(conditions).every(([k, v]) => payload[k] === v);
        if (!conditionsMet) continue;

        const agentRow = await db.query.agents.findFirst({
          where: and(eq(agents.id, rule.agentId), eq(agents.workspaceId, workspaceId)),
        });
        if (!agentRow) continue;

        // execute_approved rules only differ in intent note; the runtime's
        // approval engine enforces actual safety regardless.
        const start = await AgentRunnerService.run({
          workspaceId,
          userId,
          agentKey: agentRow.agentKey,
          objective: `[automation:${rule.name}] ${event.eventType} on ${event.entityType ?? "entity"} ${event.entityId ?? ""}`.trim(),
          triggerType: "event",
          triggerId: `${rule.id}:${event.entityId ?? event.id}`,
          inputContext: { ...payload, ruleId: rule.id, eventId: event.id },
        });

        if (start.started) anyStarted = true;
      }

      await db
        .update(agentEvents)
        .set({ status: anyStarted ? "PROCESSED" : "SKIPPED", processedAt: new Date(), error: anyStarted ? null : "cooldown or conditions not met" })
        .where(eq(agentEvents.id, event.id));
      results.push({ eventId: event.id, eventType: event.eventType, outcome: anyStarted ? "PROCESSED" : "SKIPPED" });
    }

    return results;
  }
}

/**
 * Convenience wrapper used by domain actions: authenticates, publishes, and
 * opportunistically drains pending events. Never throws into the caller.
 */
export async function publishAndMaybeProcess(params: {
  eventType: AexylEventType;
  entityType?: string;
  entityId?: string;
  payload?: Record<string, unknown>;
}) {
  try {
    const { workspaceId, userId } = await requireWorkspace();
    await AgentEventBus.publish({ workspaceId, ...params });
    await AgentEventBus.processPending(workspaceId, userId, 3);
  } catch {
    // never break the domain action
  }
}

export { ActivityService };
