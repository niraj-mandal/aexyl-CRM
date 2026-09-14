/**
 * Runner Service — bridges the registry to the runtime. Owns the
 * LLM-plan-with-deterministic-fallback logic so no agent duplicates it.
 */
import { db } from "@/db";
import { agentRuns, agentTraces } from "@/db/schema";
import { asc, eq } from "drizzle-orm";
import { AgentRuntime, type PlannerContext } from "../core/runtime/runtime";
import { getAgentDefinition, planFromModel, PlanOutputSchema } from "../registry";
import { AiGateway } from "@/lib/ai/gateway";

export class AgentRunnerService {
  /**
   * Kicks off a run (policy-checked) and executes it to a terminal state.
   * Returns the final status; UI polls the run record for live updates.
   */
  static async run(params: {
    workspaceId: string;
    userId: string;
    agentKey: string;
    objective: string;
    triggerType?: "manual" | "event" | "schedule";
    triggerId?: string;
    inputContext?: Record<string, unknown>;
    dryRun?: boolean;
  }): Promise<
    | { started: true; runId: string; status: string; result?: unknown }
    | { started: false; blocked: string; code: string }
  > {
    const def = getAgentDefinition(params.agentKey);
    if (!def) return { started: false, blocked: `Unknown agent "${params.agentKey}"`, code: "AGENT_UNKNOWN" };

    const start = await AgentRuntime.startRun({
      workspaceId: params.workspaceId,
      userId: params.userId,
      agentKey: params.agentKey,
      objective: params.objective,
      triggerType: params.triggerType,
      triggerId: params.triggerId,
      inputContext: { ...(params.inputContext ?? {}), dryRun: params.dryRun ?? false },
    });
    if ("blocked" in start) return { started: false, blocked: start.blocked, code: start.code };

    const outcome = await AgentRuntime.executeRun({
      runId: start.runId,
      userId: params.userId,
      agentKey: params.agentKey,
      planner: async (ctx: PlannerContext) => {
        const { system, user } = def.planner(ctx.objective, ctx.context);
        const llm = await AiGateway.structuredOutput({
          system,
          user,
          schema: PlanOutputSchema,
          runId: ctx.runId,
          workspaceId: ctx.workspaceId,
          agentId: ctx.agentId,
        });
        ctx.onUsage(llm.usage);

        if (llm.ok && llm.data) {
          try {
            return planFromModel(llm.data);
          } catch {
            // fall through to deterministic plan
          }
        }
        return def.fallbackPlan(ctx.objective, ctx.context);
      },
    });

    return { started: true, runId: start.runId, status: outcome.status, result: outcome.result };
  }

  static async getRun(workspaceId: string, runId: string) {
    const run = await db.query.agentRuns.findFirst({
      where: eq(agentRuns.id, runId),
    });
    if (!run || run.workspaceId !== workspaceId) return null;
    const traces = await db
      .select()
      .from(agentTraces)
      .where(eq(agentTraces.runId, runId))
      .orderBy(asc(agentTraces.stepNumber));
    return { run, traces };
  }
}
