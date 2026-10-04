/**
 * Event → Agent automation dispatcher.
 *
 * This is deliberately a bounded dispatcher, not a free-running autonomous
 * loop. Events are claimed once, mapped to a specific agent/objective, and
 * the normal AgentRuntime policy decides whether the run may start.
 */
import { db } from "@/db";
import { agentEvents } from "@/db/schema";
import { and, asc, eq, isNull } from "drizzle-orm";
import { AgentRuntime } from "@/agents/core/runtime/runtime";
import { ActivityService } from "@/services/activity.service";

type DispatchResult = {
  eventId: string;
  status: "DISPATCHED" | "SKIPPED" | "FAILED";
  runId?: string;
  reason?: string;
};

function mapEventToAgent(eventType: string) {
  switch (eventType) {
    case "OUTBOUND_REPLY_RECEIVED":
    case "HIGH_INTENT_REPLY":
    case "LEAD_INTENT_CHANGED":
      return { agentKey: "sales", objective: "Review the new prospect signal and determine the highest-value next sales action." };
    case "OUTBOUND_EVENT_CREATED":
    case "HIRING":
    case "FUNDING":
    case "EXPANSION":
    case "LAUNCH":
    case "LEADERSHIP_CHANGE":
      return { agentKey: "scout", objective: "Review this business signal, assess ICP relevance, and recommend whether it deserves outreach." };
    case "FOLLOW_UP_DUE":
    case "PROSPECT_TIMING_CHANGED":
      return { agentKey: "followup", objective: "Review due follow-ups and prepare the safest next action using CRM history and memory." };
    case "PROJECT_AT_RISK":
    case "PROJECT_OVERDUE":
      return { agentKey: "operations", objective: "Review operational risk and recommend the most important corrective action." };
    default:
      return { agentKey: "executive", objective: "Review the new workspace event and determine whether it requires attention." };
  }
}

export async function dispatchPendingAgentEvents(params: {
  workspaceId: string;
  userId: string;
  limit?: number;
}): Promise<DispatchResult[]> {
  const limit = Math.min(25, Math.max(1, params.limit ?? 10));
  const events = await db.select().from(agentEvents)
    .where(and(eq(agentEvents.workspaceId, params.workspaceId), eq(agentEvents.status, "PENDING"), isNull(agentEvents.processedAt)))
    .orderBy(asc(agentEvents.createdAt))
    .limit(limit);

  const results: DispatchResult[] = [];

  for (const event of events) {
    try {
      const mapping = mapEventToAgent(event.eventType);
      const run = await AgentRuntime.startRun({
        workspaceId: params.workspaceId,
        userId: params.userId,
        agentKey: mapping.agentKey,
        objective: mapping.objective,
        triggerType: "event",
        triggerId: event.id,
        inputContext: {
          eventId: event.id,
          eventType: event.eventType,
          entityType: event.entityType,
          entityId: event.entityId,
          payload: event.payload,
        },
      });

      if ("blocked" in run) {
        await db.update(agentEvents).set({ status: "FAILED", error: run.blocked, processedAt: new Date() }).where(eq(agentEvents.id, event.id));
        results.push({ eventId: event.id, status: "SKIPPED", reason: run.blocked });
        continue;
      }

      await db.update(agentEvents).set({ status: "PROCESSED", processedAt: new Date() }).where(eq(agentEvents.id, event.id));
      await ActivityService.logAudit(params.workspaceId, params.userId, "AGENT_EVENT_DISPATCHED", "AGENT_EVENT", event.id, {
        agentKey: mapping.agentKey,
        runId: run.runId,
        eventType: event.eventType,
      });
      results.push({ eventId: event.id, status: "DISPATCHED", runId: run.runId });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown dispatch error";
      await db.update(agentEvents).set({ status: "FAILED", error: message.slice(0, 500), processedAt: new Date() }).where(eq(agentEvents.id, event.id));
      results.push({ eventId: event.id, status: "FAILED", reason: message });
    }
  }

  return results;
}

/** Convenience helper for creating a durable event from domain code. */
export async function enqueueAgentEvent(params: {
  workspaceId: string;
  eventType: string;
  entityType?: string;
  entityId?: string;
  payload?: Record<string, unknown>;
}) {
  const [event] = await db.insert(agentEvents).values({
    workspaceId: params.workspaceId,
    eventType: params.eventType,
    entityType: params.entityType ?? null,
    entityId: params.entityId ?? null,
    payload: params.payload ?? {},
    status: "PENDING",
  }).returning();
  return event;
}      const toolByAgent: Record<string, string | null> = {
        sales: "crm.create_activity",
        scout: "crm.create_activity",
        followup: "crm.create_activity",
        operations: "crm.create_activity",
        executive: "intelligence.get_attention_items",
      };
      const toolId = toolByAgent[mapping.agentKey] ?? null;
      const entityId = event.entityId ?? undefined;
      const activityType = event.eventType.includes("REPLY") ? "OUTREACH" : event.eventType.includes("FOLLOW") ? "FOLLOW_UP" : "NOTE";
      const planner = async (): Promise<AgentPlan> => ({
        summary: mapping.objective,
        confidence: "HIGH",
        confidenceEvidence: ["Triggered by a persisted workspace event."],
        requiresApproval: false,
        actions: [{
          step: 1,
          description: toolId === "crm.create_activity" ? "Record the event in the CRM timeline so the team has an auditable next-action signal." : "Read current attention items and produce the next recommendation.",
          toolId,
          toolArguments: toolId === "crm.create_activity" && entityId
            ? { leadId: entityId, type: activityType, title: event.eventType, description: JSON.stringify(event.payload ?? {}).slice(0, 1500) }
            : { limit: 5 },
          riskLevel: "LOW",
          requiresApproval: false,
        }],
      });
      const execution = await AgentRuntime.executeRun({
        runId: run.runId,
        userId: params.userId,
        agentKey: mapping.agentKey,
        planner,
      });
      await db.update(agentEvents).set({ status: "FAILED", error: run.blocked, processedAt: new Date() }).where(eq(agentEvents.id, event.id));
        results.push({ eventId: event.id, status: "SKIPPED", reason: run.blocked });
        continue;
      }

      await db.update(agentEvents).set({ status: "PROCESSED", processedAt: new Date() }).where(eq(agentEvents.id, event.id));
      await ActivityService.logAudit(params.workspaceId, params.userId, "AGENT_EVENT_DISPATCHED", "AGENT_EVENT", event.id, {
        agentKey: mapping.agentKey,
        runId: run.runId,
        eventType: event.eventType,
      });
      results.push({ eventId: event.id, status: "DISPATCHED", runId: run.runId });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown dispatch error";
      await db.update(agentEvents).set({ status: "FAILED", error: message.slice(0, 500), processedAt: new Date() }).where(eq(agentEvents.id, event.id));
      results.push({ eventId: event.id, status: "FAILED", reason: message });
    }
  }

  return results;
}

/** Convenience helper for creating a durable event from domain code. */
export async function enqueueAgentEvent(params: {
  workspaceId: string;
  eventType: string;
  entityType?: string;
  entityId?: string;
  payload?: Record<string, unknown>;
}) {
  const [event] = await db.insert(agentEvents).values({
    workspaceId: params.workspaceId,
    eventType: params.eventType,
    entityType: params.entityType ?? null,
    entityId: params.entityId ?? null,
    payload: params.payload ?? {},
    status: "PENDING",
  }).returning();
  return event;
}
