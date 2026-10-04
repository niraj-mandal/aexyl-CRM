"use server";

import { requireWorkspace } from "@/lib/auth/workspace";
import { enqueueAgentEvent, dispatchPendingAgentEvents } from "@/agents/core/automation/dispatcher";
import { revalidatePath } from "next/cache";

export async function enqueueAgentEventAction(input: {
  eventType: string;
  entityType?: string;
  entityId?: string;
  payload?: Record<string, unknown>;
}) {
  const { workspaceId } = await requireWorkspace();
  const event = await enqueueAgentEvent({ workspaceId, ...input });
  revalidatePath("/agents");
  revalidatePath("/agents/automations");
  return { success: true, eventId: event.id };
}

export async function dispatchPendingAgentEventsAction(limit = 10) {
  const { workspaceId, userId } = await requireWorkspace();
  const result = await dispatchPendingAgentEvents({ workspaceId, userId, limit });
  revalidatePath("/agents");
  revalidatePath("/agents/runs");
  return { success: true, result };
}
