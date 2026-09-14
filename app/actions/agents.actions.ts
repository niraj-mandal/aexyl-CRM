"use server";

import { requireWorkspace } from "@/lib/auth/workspace";
import { AgentRunnerService } from "@/agents/services/runner.service";
import { AgentEventBus } from "@/agents/events/bus";
import {
  approveAndExecute,
  rejectApproval,
  cancelApproval,
  expireStaleApprovals,
  setKillSwitch,
} from "@/agents/services/approvals.service";
import { ensureWorkspaceAgents, isKillSwitchEngaged } from "@/agents/registry";
import { db } from "@/db";
import { agents, agentRuns, agentApprovals, automationRules } from "@/db/schema";
import { and, desc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

// --- run + events ------------------------------------------------------------

export async function runAgentAction(agentKey: string, objective: string, inputContext?: Record<string, unknown>) {
  const { workspaceId, userId } = await requireWorkspace();
  await ensureWorkspaceAgents(workspaceId);

  if (await isKillSwitchEngaged(workspaceId)) {
    return { started: false as const, blocked: "All agents are disabled by the workspace kill switch.", code: "KILL_SWITCH" };
  }

  const trimmed = objective.trim();
  if (trimmed.length < 5) {
    return { started: false as const, blocked: "Describe the objective (min 5 characters).", code: "INVALID_INPUT" };
  }

  const result = await AgentRunnerService.run({
    workspaceId,
    userId,
    agentKey,
    objective: trimmed.slice(0, 400),
    triggerType: "manual",
    inputContext,
  });

  // Opportunistically drain pending automation events too.
  await AgentEventBus.processPending(workspaceId, userId, 3);
  revalidatePath("/agents");
  return result;
}

export async function processEventsAction() {
  const { workspaceId, userId } = await requireWorkspace();
  await ensureWorkspaceAgents(workspaceId);
  const results = await AgentEventBus.processPending(workspaceId, userId, 10);
  revalidatePath("/agents");
  return { processed: results.length, results };
}

// --- approvals -----------------------------------------------------------------

export async function approveAgentActionAction(approvalId: string, dryRun = false) {
  const { workspaceId, userId } = await requireWorkspace();
  const result = await approveAndExecute({ workspaceId, approvalId, reviewedBy: userId, dryRun });
  revalidatePath("/agents/approvals");
  revalidatePath("/agents");
  return result;
}

export async function rejectApprovalAction(approvalId: string) {
  const { workspaceId, userId } = await requireWorkspace();
  const result = await rejectApproval({ workspaceId, approvalId, reviewedBy: userId });
  revalidatePath("/agents/approvals");
  revalidatePath("/agents");
  return result;
}

export async function cancelApprovalAction(approvalId: string) {
  const { workspaceId, userId } = await requireWorkspace();
  const result = await cancelApproval({ workspaceId, approvalId, reviewedBy: userId });
  revalidatePath("/agents/approvals");
  return result;
}

// --- management -----------------------------------------------------------------

export async function setKillSwitchAction(engaged: boolean) {
  const { workspaceId, userId } = await requireWorkspace();
  await ensureWorkspaceAgents(workspaceId);
  await setKillSwitch(workspaceId, userId, engaged);
  revalidatePath("/agents");
  return { engaged };
}

export async function updateAgentConfigAction(
  agentKey: string,
  config: {
    enabled?: boolean;
    autonomyLevel?: number;
    allowedTools?: string[];
    dailyRunLimit?: number;
    maxTokensPerRun?: number;
    dailyBudgetMicroUsd?: number;
  }
) {
  const { workspaceId } = await requireWorkspace();
  const clampInt = (v: number, min: number, max: number) => Math.min(max, Math.max(min, Math.round(v)));
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (typeof config.enabled === "boolean") patch.enabled = config.enabled;
  if (typeof config.autonomyLevel === "number") patch.autonomyLevel = clampInt(config.autonomyLevel, 0, 3);
  if (Array.isArray(config.allowedTools)) patch.allowedTools = config.allowedTools.slice(0, 30);
  if (typeof config.dailyRunLimit === "number") patch.dailyRunLimit = clampInt(config.dailyRunLimit, 0, 1000);
  if (typeof config.maxTokensPerRun === "number") patch.maxTokensPerRun = clampInt(config.maxTokensPerRun, 0, 200000);
  if (typeof config.dailyBudgetMicroUsd === "number") patch.dailyBudgetMicroUsd = clampInt(config.dailyBudgetMicroUsd, 0, 100_000_000);

  await db
    .update(agents)
    .set(patch)
    .where(and(eq(agents.workspaceId, workspaceId), eq(agents.agentKey, agentKey)));
  revalidatePath("/agents");
  revalidatePath(`/agents/${agentKey}`);
  return { success: true };
}

export async function toggleAutomationRuleAction(ruleId: string, enabled: boolean) {
  const { workspaceId } = await requireWorkspace();
  await db
    .update(automationRules)
    .set({ enabled, updatedAt: new Date() })
    .where(and(eq(automationRules.id, ruleId), eq(automationRules.workspaceId, workspaceId)));
  revalidatePath("/agents");
  return { success: true };
}

// --- read helpers (server components) ---------------------------------------------

export async function getAgentsOverview(workspaceId: string) {
  await ensureWorkspaceAgents(workspaceId);
  const rows = await db
    .select()
    .from(agents)
    .where(eq(agents.workspaceId, workspaceId))
    .orderBy(agents.agentKey);
  const killSwitch = rows.find((r) => r.agentKey === "__kill_switch");
  return {
    agents: rows.filter((r) => r.agentKey !== "__kill_switch"),
    killSwitchEngaged: killSwitch ? !killSwitch.enabled : false,
  };
}

export async function getRecentRuns(workspaceId: string, limit = 10) {
  return db
    .select()
    .from(agentRuns)
    .where(eq(agentRuns.workspaceId, workspaceId))
    .orderBy(desc(agentRuns.createdAt))
    .limit(limit);
}

export async function getPendingApprovals(workspaceId: string) {
  await expireStaleApprovals(workspaceId);
  return db
    .select()
    .from(agentApprovals)
    .where(and(eq(agentApprovals.workspaceId, workspaceId), eq(agentApprovals.status, "PENDING")))
    .orderBy(desc(agentApprovals.requestedAt));
}
