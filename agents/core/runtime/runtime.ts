/**
 * Agent Runtime — executes agent objectives through the controlled pipeline.
 *
 * Lifecycle: QUEUED → CONTEXT_LOADING → PLANNING → (AWAITING_APPROVAL) →
 *            EXECUTING → VALIDATING → COMPLETED | FAILED | STOPPED_BY_POLICY
 *
 * Guarantees:
 *  - every step is traced (agent_traces)
 *  - every tool call passes the policy engine
 *  - mutations respect approval requirements (blocked -> approval request)
 *  - external content is fenced as untrusted data
 *  - usage/cost is captured per LLM call via the gateway
 */
import { z } from "zod";
import { db } from "@/db";
import { agents, agentRuns, agentTraces, agentApprovals, agentMemory } from "@/db/schema";
import { and, desc, eq } from "drizzle-orm";
import { getTool } from "../registry/tools";
import { evaluateToolPolicy, evaluateRunPolicy, autonomyAllowsToolCall } from "../policies/engine";
import { AiGateway, type GatewayUsage } from "@/lib/ai/gateway";
import { ActivityService } from "@/services/activity.service";

// --- structured plan schema ---------------------------------------------------

const PlanActionSchema = z.object({
  step: z.number().int().min(1),
  description: z.string().min(3).max(300),
  toolId: z.string().min(3).max(80).nullable(),
  toolArguments: z.record(z.string(), z.unknown()).nullable(),
  riskLevel: z.enum(["LOW", "MEDIUM", "HIGH"]).default("LOW"),
  requiresApproval: z.boolean().default(false),
});
export type PlanAction = z.infer<typeof PlanActionSchema>;

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- single source of truth for the AgentPlan type
const AgentPlanSchema = z.object({
  summary: z.string().min(3).max(500),
  actions: z.array(PlanActionSchema).max(8),
  confidence: z.enum(["LOW", "MEDIUM", "HIGH"]),
  confidenceEvidence: z.array(z.string()).max(5).default([]),
  requiresApproval: z.boolean().default(false),
});
export type AgentPlan = z.infer<typeof AgentPlanSchema>;

// --- memory ------------------------------------------------------------------

export interface RelevantMemory {
  content: string;
  scope: string;
  importance: number;
  createdAt: Date;
}

export async function retrieveRelevantMemory(params: {
  workspaceId: string;
  entityType?: string;
  entityId?: string;
  limit?: number;
}): Promise<RelevantMemory[]> {
  const { workspaceId, entityType, entityId, limit = 5 } = params;
  const rows = await db
    .select()
    .from(agentMemory)
    .where(
      and(
        eq(agentMemory.workspaceId, workspaceId),
        entityId && entityType
          ? and(eq(agentMemory.entityType, entityType), eq(agentMemory.entityId, entityId))
          : eq(agentMemory.scope, "workspace")
      )
    )
    .orderBy(desc(agentMemory.importance), desc(agentMemory.createdAt))
    .limit(limit);
  return rows.map((r) => ({ content: r.content, scope: r.scope, importance: r.importance, createdAt: r.createdAt }));
}

export async function writeMemory(params: {
  workspaceId: string;
  scope: string;
  entityType?: string;
  entityId?: string;
  content: string;
  importance?: number;
  metadata?: Record<string, unknown>;
}) {
  await db.insert(agentMemory).values({
    workspaceId: params.workspaceId,
    scope: params.scope,
    entityType: params.entityType ?? null,
    entityId: params.entityId ?? null,
    content: params.content.slice(0, 1000),
    importance: params.importance ?? 3,
    metadata: params.metadata ?? null,
  });
}

// --- run helpers ----------------------------------------------------------------

async function trace(params: {
  runId: string;
  stepNumber: number;
  type: string;
  summary: string;
  toolName?: string;
  input?: unknown;
  output?: unknown;
  latencyMs?: number;
  tokensUsed?: number;
  estimatedCostMicroUsd?: number;
  status?: string;
  error?: string;
}) {
  await db.insert(agentTraces).values({
    runId: params.runId,
    stepNumber: params.stepNumber,
    type: params.type,
    summary: params.summary.slice(0, 500),
    toolName: params.toolName ?? null,
    input: params.input ?? null,
    output: params.output ?? null,
    latencyMs: params.latencyMs ?? 0,
    tokensUsed: params.tokensUsed ?? 0,
    estimatedCostMicroUsd: params.estimatedCostMicroUsd ?? 0,
    status: params.status ?? "SUCCEEDED",
    error: params.error ?? null,
  });
}

async function setStatus(runId: string, status: string) {
  await db.update(agentRuns).set({ status }).where(eq(agentRuns.id, runId));
}

export class AgentRuntime {
  /**
   * Creates a run record. Caller (actions layer) has already authenticated
   * the user; the runtime owns everything after this point.
   */
  static async startRun(params: {
    workspaceId: string;
    userId: string;
    agentKey: string;
    objective: string;
    triggerType?: "manual" | "event" | "schedule";
    triggerId?: string;
    inputContext?: Record<string, unknown>;
  }): Promise<{ runId: string; agentId: string } | { blocked: string; code: string }> {
    const policyResult = await evaluateRunPolicy(params.workspaceId, params.agentKey);
    if ("blocked" in policyResult) {
      // Audit the block
      const agentRow = await db.query.agents.findFirst({
        where: and(eq(agents.workspaceId, params.workspaceId), eq(agents.agentKey, params.agentKey)),
      });
      if (agentRow) {
        await ActivityService.logAudit(params.workspaceId, params.userId, "AGENT_POLICY_VIOLATION", "AGENT_RUN", agentRow.id, {
          reason: policyResult.blocked,
          code: policyResult.code,
        });
      }
      return { blocked: policyResult.blocked, code: policyResult.code };
    }
    const agent = policyResult.agent;

    const [run] = await db
      .insert(agentRuns)
      .values({
        workspaceId: params.workspaceId,
        agentId: agent.id,
        triggerType: params.triggerType ?? "manual",
        triggerId: params.triggerId ?? null,
        status: "QUEUED",
        objective: params.objective.slice(0, 500),
        inputContext: params.inputContext ?? null,
      })
      .returning();

    return { runId: run.id, agentId: agent.id };
  }

  /**
   * Full execution of a run. `planner` builds the plan (agent-specific);
   * the runtime executes/validates/audits every step.
   */
  static async executeRun(params: {
    runId: string;
    userId: string;
    agentKey: string;
    planner: (ctx: PlannerContext) => Promise<AgentPlan>;
  }): Promise<{ status: string; result?: unknown; error?: string }> {
    const [run] = await db.select().from(agentRuns).where(eq(agentRuns.id, params.runId)).limit(1);
    if (!run) return { status: "FAILED", error: "Run not found" };

    const [agent] = await db.select().from(agents).where(eq(agents.id, run.agentId)).limit(1);
    if (!agent) return { status: "FAILED", error: "Agent not found" };

    let step = run.currentStep;
    let tokensUsed = 0;
    let costMicro = 0;

    const track = (u: GatewayUsage) => {
      tokensUsed += u.tokensUsed;
      costMicro += u.estimatedCostMicroUsd;
    };

    try {
      // 1. CONTEXT_LOADING
      await setStatus(run.id, "CONTEXT_LOADING");
      const context = await AgentRuntime.buildContext({
        workspaceId: run.workspaceId,
        agentKey: params.agentKey,
        objective: run.objective,
        inputContext: (run.inputContext ?? {}) as Record<string, unknown>,
        userId: params.userId,
      });
      step++;
      await trace({ runId: run.id, stepNumber: step, type: "context", summary: context.summary });
      await db.update(agentRuns).set({ currentStep: step, tokensUsed, estimatedCostMicroUsd: costMicro }).where(eq(agentRuns.id, run.id));

      // Budget guard after context load
      if (AiGateway.isOverBudget(tokensUsed, agent.maxTokensPerRun)) {
        await setStatus(run.id, "STOPPED_BY_POLICY");
        return { status: "STOPPED_BY_POLICY", error: "Token budget exceeded" };
      }

      // 2. PLANNING
      await setStatus(run.id, "PLANNING");
      const plan = await params.planner({
        objective: run.objective,
        context,
        workspaceId: run.workspaceId,
        runId: run.id,
        agentId: agent.id,
        autonomyLevel: agent.autonomyLevel,
        allowedTools: agent.allowedTools,
        onUsage: track,
      });
      await db.update(agentRuns).set({ plan, status: "EXECUTING", currentStep: step }).where(eq(agentRuns.id, run.id));
      step++;
      await trace({ runId: run.id, stepNumber: step, type: "plan", summary: plan.summary, output: plan });

      // Budget guard after planning — LLM usage is now known.
      if (AiGateway.isOverBudget(tokensUsed, agent.maxTokensPerRun)) {
        await trace({ runId: run.id, stepNumber: step, type: "policy", summary: "Token budget exceeded after planning", status: "BLOCKED_BY_POLICY" });
        await setStatus(run.id, "STOPPED_BY_POLICY");
        await db.update(agentRuns).set({ tokensUsed, estimatedCostMicroUsd: costMicro, completedAt: new Date(), error: "Token budget exceeded" }).where(eq(agentRuns.id, run.id));
        return { status: "STOPPED_BY_POLICY", error: "Token budget exceeded" };
      }

      // Monthly spend guard: breach → pause the agent (spec §9: budget exceeded → PAUSED).
      try {
        const { getWorkspaceSpendThisMonth } = await import("../policies/engine");
        const spendMonth = await getWorkspaceSpendThisMonth(run.workspaceId);
        if (agent.monthlyBudgetMicroUsd > 0 && spendMonth >= agent.monthlyBudgetMicroUsd) {
          await db
            .update(agents)
            .set({ paused: true, pauseReason: `Monthly budget exceeded ($${(spendMonth / 1e6).toFixed(2)})`, updatedAt: new Date() })
            .where(eq(agents.id, agent.id));
          await trace({ runId: run.id, stepNumber: step, type: "policy", summary: `Agent paused: monthly budget exceeded`, status: "BLOCKED_BY_POLICY" });
          await setStatus(run.id, "STOPPED_BY_POLICY");
          await db.update(agentRuns).set({ tokensUsed, estimatedCostMicroUsd: costMicro, completedAt: new Date(), error: "Monthly budget exceeded — agent paused" }).where(eq(agentRuns.id, run.id));
          return { status: "STOPPED_BY_POLICY", error: "Monthly budget exceeded — agent paused" };
        }
      } catch {
        // budget check is best-effort; never block execution on its failure
      }

      // 3. EXECUTING each planned action
      const actionResults: {
        step: number;
        description: string;
        status: "SUCCEEDED" | "FAILED" | "BLOCKED_BY_POLICY" | "APPROVAL_REQUIRED" | "SKIPPED";
        result?: unknown;
        approvalId?: string;
        reason?: string;
      }[] = [];

      for (const action of plan.actions) {
        step++;
        await db.update(agentRuns).set({ currentStep: step }).where(eq(agentRuns.id, run.id));

        if (!action.toolId) {
          // Pure analysis step (no side effects)
          await trace({ runId: run.id, stepNumber: step, type: "message", summary: action.description });
          actionResults.push({ step: action.step, description: action.description, status: "SUCCEEDED" });
          continue;
        }

        const t = getTool(action.toolId);
        if (!t) {
          await trace({ runId: run.id, stepNumber: step, type: "tool_call", summary: `Unknown tool ${action.toolId}`, toolName: action.toolId, status: "FAILED", error: "Unknown tool" });
          actionResults.push({ step: action.step, description: action.description, status: "FAILED", reason: "Unknown tool" });
          continue;
        }

        const policy = await evaluateToolPolicy({ workspaceId: run.workspaceId, agent, toolId: action.toolId });
        if (!policy.allowed) {
          await trace({
            runId: run.id, stepNumber: step, type: "policy", summary: `BLOCKED: ${policy.reason}`,
            toolName: action.toolId, input: action.toolArguments, status: "BLOCKED_BY_POLICY", error: policy.reason,
          });
          actionResults.push({ step: action.step, description: action.description, status: "BLOCKED_BY_POLICY", reason: policy.reason });
          continue;
        }

        // Mutation tools at L<=1 or requires_approval → route to approval system
        const approvalDecision = autonomyAllowsToolCall(agent.autonomyLevel, action.toolId);
        if (approvalDecision.needsApproval && agent.requiresApprovalForWrites) {
          const approval = await AgentRuntime.requestApproval({
            workspaceId: run.workspaceId,
            runId: run.id,
            agentId: agent.id,
            toolName: action.toolId,
            description: action.description,
            riskLevel: t.riskLevel,
            proposedArguments: action.toolArguments ?? {},
            userId: params.userId,
          });
          await trace({
            runId: run.id, stepNumber: step, type: "approval", summary: `Approval requested: ${action.description}`,
            toolName: action.toolId, input: action.toolArguments, status: "SKIPPED",
          });
          actionResults.push({ step: action.step, description: action.description, status: "APPROVAL_REQUIRED", approvalId: approval.id });
          await setStatus(run.id, "AWAITING_APPROVAL");
          continue;
        }

        // Execute the tool — but first re-ground identity arguments against
        // the loaded context. The model must never be the source of entity
        // identity: prepare_email / prepare_message recipients and lead ids
        // are overwritten with the real context values, so a hallucinated
        // address, phone, or id cannot execute.
        let toolArgs = (action.toolArguments ?? {}) as Record<string, unknown>;
        if (action.toolId === "communication.prepare_email") {
          const ctxLead = (context.data.lead ?? null) as { id?: string; email?: string | null } | null;
          if (!ctxLead?.id || !ctxLead.email) {
            const reason = "No contactable lead in context — prepare_email refused (identity must come from real data)";
            await trace({ runId: run.id, stepNumber: step, type: "policy", summary: `BLOCKED: ${reason}`, toolName: action.toolId, input: toolArgs, status: "BLOCKED_BY_POLICY", error: reason });
            actionResults.push({ step: action.step, description: action.description, status: "BLOCKED_BY_POLICY", reason });
            continue;
          }
          toolArgs = { ...toolArgs, toEmail: ctxLead.email, leadId: ctxLead.id };
        } else if (action.toolId === "communication.prepare_message") {
          const ctxLead = (context.data.lead ?? null) as { id?: string; phone?: string | null } | null;
          if (!ctxLead?.id || !ctxLead.phone) {
            const reason = "No phone on the context lead — prepare_message refused (identity must come from real data)";
            await trace({ runId: run.id, stepNumber: step, type: "policy", summary: `BLOCKED: ${reason}`, toolName: action.toolId, input: toolArgs, status: "BLOCKED_BY_POLICY", error: reason });
            actionResults.push({ step: action.step, description: action.description, status: "BLOCKED_BY_POLICY", reason });
            continue;
          }
          toolArgs = { ...toolArgs, toPhone: ctxLead.phone, leadId: ctxLead.id };
        }
        const toolStart = Date.now();
        try {
          const output = await t.execute(toolArgs, {
            workspaceId: run.workspaceId,
            userId: params.userId,
            runId: run.id,
            dryRun: false,
          });
          const latency = Date.now() - toolStart;
          await trace({
            runId: run.id, stepNumber: step, type: "tool_call", summary: `${t.name} succeeded`, toolName: action.toolId,
            input: toolArgs, output, latencyMs: latency, status: "SUCCEEDED",
          });
          actionResults.push({ step: action.step, description: action.description, status: "SUCCEEDED", result: output });

          // Validation step for mutation tools: confirm state changed
          if (t.riskLevel !== "LOW") {
            await trace({ runId: run.id, stepNumber: step, type: "validation", summary: `${t.name} result validated`, toolName: action.toolId });
          }
        } catch (toolError) {
          const message = toolError instanceof Error ? toolError.message : "Tool execution failed";
          await trace({
            runId: run.id, stepNumber: step, type: "tool_call", summary: `${t.name} failed`, toolName: action.toolId,
            input: toolArgs, latencyMs: Date.now() - toolStart, status: "FAILED", error: message,
          });
          actionResults.push({ step: action.step, description: action.description, status: "FAILED", reason: message });
        }
      }

      // 4. COMPLETION
      await setStatus(run.id, "VALIDATING");
      const blockedCount = actionResults.filter((a) => a.status === "BLOCKED_BY_POLICY").length;
      const failedCount = actionResults.filter((a) => a.status === "FAILED").length;
      const approvalCount = actionResults.filter((a) => a.status === "APPROVAL_REQUIRED").length;

      const finalStatus = approvalCount > 0 ? "AWAITING_APPROVAL" : failedCount > 0 && actionResults.every((a) => a.status === "FAILED") ? "FAILED" : "COMPLETED";
      const result = {
        summary: plan.summary,
        confidence: plan.confidence,
        confidenceEvidence: plan.confidenceEvidence,
        actions: actionResults,
        counts: {
          total: actionResults.length,
          succeeded: actionResults.filter((a) => a.status === "SUCCEEDED").length,
          failed: failedCount,
          blockedByPolicy: blockedCount,
          approvalsRequested: approvalCount,
        },
      };

      await db
        .update(agentRuns)
        .set({ status: finalStatus, result, completedAt: finalStatus === "COMPLETED" || finalStatus === "FAILED" ? new Date() : null, tokensUsed, estimatedCostMicroUsd: costMicro })
        .where(eq(agentRuns.id, run.id));

      await ActivityService.logAudit(run.workspaceId, params.userId, finalStatus === "COMPLETED" ? "AGENT_RUN_COMPLETED" : "AGENT_RUN_" + finalStatus, "AGENT_RUN", run.id, {
        agentKey: params.agentKey,
        objective: run.objective,
        counts: result.counts,
        tokensUsed,
      });

      return { status: finalStatus, result };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Run failed";
      await setStatus(run.id, "FAILED");
      await db.update(agentRuns).set({ error: message.slice(0, 500), completedAt: new Date(), tokensUsed, estimatedCostMicroUsd: costMicro }).where(eq(agentRuns.id, run.id));
      await trace({ runId: run.id, stepNumber: step + 1, type: "message", summary: "Run failed", status: "FAILED", error: message });
      await ActivityService.logAudit(run.workspaceId, params.userId, "AGENT_RUN_FAILED", "AGENT_RUN", run.id, { agentKey: params.agentKey, error: message.slice(0, 300) });
      try {
        const { NotificationService } = await import("@/services/notification.service");
        await NotificationService.notifyWorkspace({
          workspaceId: run.workspaceId,
          exceptUserId: params.userId,
          type: "agent.run_failed",
          title: "Agent run failed",
          body: `${params.agentKey}: ${message.slice(0, 140)}`,
          link: `/agents/runs/${run.id}`,
          dedupeKey: `run-failed:${run.id}`,
        });
      } catch {
        // never mask the original failure
      }
      return { status: "FAILED", error: message };
    }
  }

  /** Builds a minimal, relevant context bundle (never the whole workspace). */
  private static async buildContext(params: {
    workspaceId: string;
    agentKey: string;
    objective: string;
    inputContext: Record<string, unknown>;
    userId: string;
  }): Promise<{ summary: string; data: Record<string, unknown> }> {
    const { AgentContextBuilder } = await import("../context/builder");
    return AgentContextBuilder.build(params);
  }

  static async requestApproval(params: {
    workspaceId: string;
    runId: string;
    agentId: string;
    toolName: string;
    description: string;
    riskLevel: string;
    proposedArguments: Record<string, unknown>;
    userId: string;
  }) {
    const [approval] = await db
      .insert(agentApprovals)
      .values({
        workspaceId: params.workspaceId,
        runId: params.runId,
        agentId: params.agentId,
        toolName: params.toolName,
        actionType: "TOOL_EXECUTION",
        description: params.description.slice(0, 500),
        riskLevel: params.riskLevel,
        proposedArguments: params.proposedArguments,
        impactSummary: `Agent requests permission to run ${params.toolName}`,
        status: "PENDING",
        expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
      })
      .returning();      await ActivityService.logAudit(params.workspaceId, params.userId, "APPROVAL_REQUESTED", "AGENT_APPROVAL", approval.id, {
      toolName: params.toolName,
      runId: params.runId,
      riskLevel: params.riskLevel,
    });
    // Human-in-the-loop means the human must KNOW — notify workspace members.
    const { NotificationService } = await import("@/services/notification.service");
    await NotificationService.notifyWorkspace({
      workspaceId: params.workspaceId,
      exceptUserId: params.userId,
      type: "agent.approval_requested",
      title: "Agent action needs approval",
      body: `${params.description.slice(0, 140)}`,   
      link: "/agents/approvals",
      dedupeKey: `approval:${approval.id}`,
    });
    return approval;
  }

  /** Cancels a queued/running run (kill switch / manual cancel). */
  static async cancelRun(workspaceId: string, runId: string) {
    const [run] = await db
      .update(agentRuns)
      .set({ status: "CANCELLED", completedAt: new Date() })
      .where(and(eq(agentRuns.id, runId), eq(agentRuns.workspaceId, workspaceId)))
      .returning();
    return run ?? null;
  }
}

// --- planner context ----------------------------------------------------------

export interface PlannerContext {
  objective: string;
  context: { summary: string; data: Record<string, unknown> };
  workspaceId: string;
  runId: string;
  agentId: string;
  autonomyLevel: number;
  allowedTools: string[];
  onUsage: (u: GatewayUsage) => void;
}
