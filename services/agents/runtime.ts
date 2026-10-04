import { CrmService } from "@/services/crm.service";

export type AgentRunRequest = {
  agentKey: string;
  objective: string;
  triggerType?: "manual" | "event" | "schedule";
  triggerId?: string;
  inputContext?: Record<string, unknown>;
};

export type AgentPolicyDecision = {
  allowed: boolean;
  requiresApproval: boolean;
  reason: string;
};

const READ_ONLY = new Set(["crm.read","signals.read","pipeline.read","projects.read","intelligence.read"]);
const PREPARE = new Set(["outreach.prepare"]);

export function evaluateAgentPolicy(agent: any, requestedTool?: string): AgentPolicyDecision {
  if (!agent.enabled || agent.paused) return { allowed: false, requiresApproval: false, reason: agent.pauseReason || "Agent is disabled or paused." };
  if (requestedTool && agent.allowedTools.length && !agent.allowedTools.includes(requestedTool))
    return { allowed: false, requiresApproval: false, reason: "Tool is not in the agent allowlist." };
  if (!requestedTool || READ_ONLY.has(requestedTool)) return { allowed: true, requiresApproval: false, reason: "Read-only operation allowed." };
  if (PREPARE.has(requestedTool)) return { allowed: true, requiresApproval: true, reason: "Preparation is allowed; execution remains human-approved." };
  const override = requestedTool ? agent.toolPolicies?.[requestedTool] : undefined;
  if (override === "BLOCK") return { allowed: false, requiresApproval: false, reason: "Blocked by agent tool policy." };
  if (override === "ALLOW" && agent.autonomyLevel >= 3) return { allowed: true, requiresApproval: false, reason: "Explicit policy allows controlled execution." };
  return { allowed: true, requiresApproval: true, reason: "Write/action requires approval by default." };
}

export async function startAgentRun(workspaceId: string, request: AgentRunRequest) {
  const registry = await CrmService.getAgentRegistry(workspaceId);
  const agent = registry.find((a: any) => a.agentKey === request.agentKey);
  if (!agent) throw new Error("Agent is not registered for this workspace.");

  const policy = evaluateAgentPolicy(agent);
  if (!policy.allowed) throw new Error(policy.reason);

  const run = await CrmService.createAgentRun(workspaceId, agent.id, {
    triggerType: request.triggerType ?? "manual",
    triggerId: request.triggerId,
    status: "INITIALIZING",
    objective: request.objective,
    inputContext: request.inputContext ?? {},
    startedAt: new Date(),
  });

  await CrmService.traceAgentRun(run.id, {
    stepNumber: 0,
    type: "context",
    summary: "Agent run initialized and workspace policy checked.",
    input: request.inputContext ?? {},
    output: { agentKey: agent.agentKey, autonomyLevel: agent.autonomyLevel },
    status: "SUCCEEDED",
  });

  return { run, agent, policy };
}

export async function requestAgentApproval(workspaceId: string, runId: string, toolName: string, actionType: string, description: string, proposedArguments: Record<string, unknown>, riskLevel: "LOW"|"MEDIUM"|"HIGH" = "MEDIUM") {
  const run = await CrmService.getAgentRun(workspaceId, runId);
  if (!run) throw new Error("Agent run not found.");
  const registry = await CrmService.getAgentRegistry(workspaceId);
  const agent = registry.find((a: any) => a.id === run.agentId);
  if (!agent) throw new Error("Agent not found.");

  const policy = evaluateAgentPolicy(agent, toolName);
  if (!policy.allowed) throw new Error(policy.reason);
  if (!policy.requiresApproval) return { approvalRequired: false, run };

  const approval = await CrmService.createAgentApproval(workspaceId, {
    runId, agentId: agent.id, toolName, actionType, description, riskLevel,
    proposedArguments, impactSummary: "Prepared by AEXYL agent runtime; no action executed.",
    status: "PENDING", expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
  });
  await CrmService.updateAgentRun(workspaceId, runId, { status: "AWAITING_APPROVAL" });
  await CrmService.traceAgentRun(runId, {
    stepNumber: (run.currentStep ?? 0) + 1, type: "approval", summary: "Action paused pending human approval.",
    toolName, input: proposedArguments, output: { approvalId: approval.id }, status: "SUCCEEDED",
  });
  return { approvalRequired: true, approval, runId };
}

export async function completeAgentRun(workspaceId: string, runId: string, result: Record<string, unknown>) {
  const run = await CrmService.getAgentRun(workspaceId, runId);
  if (!run) throw new Error("Agent run not found.");
  const updated = await CrmService.updateAgentRun(workspaceId, runId, { status: "COMPLETED", result, completedAt: new Date() });
  await CrmService.traceAgentRun(runId, { stepNumber: (run.currentStep ?? 0) + 1, type: "validation", summary: "Agent run completed.", output: result, status: "SUCCEEDED" });
  return updated;
}
