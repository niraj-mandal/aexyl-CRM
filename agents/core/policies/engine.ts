/**
 * Agent Policy Engine — centralized safety logic. Agents never decide their
 * own permissions; every tool call and every run passes through here.
 *
 * Evaluation order (fail fast):
 *   kill switch → agent enabled → autonomy → tool allowlist → rate limit
 *   → daily run limit → daily budget → approval requirement → execute
 *
 * Anything that reaches the caller as BLOCKED also lands in audit_logs via
 * the runtime, so policy violations are always traceable.
 */
import { db } from "@/db";
import { agents, agentRuns, agentUsage } from "@/db/schema";
import { and, eq, gte, sql } from "drizzle-orm";
import { getTool, AGENT_TOOLS } from "../registry/tools";

export type PolicyDecision =
  | { allowed: true }
  | { allowed: false; reason: string; code: PolicyViolationCode };

export type PolicyViolationCode =
  | "KILL_SWITCH"
  | "AGENT_DISABLED"
  | "AGENT_PAUSED"
  | "AGENT_UNKNOWN"
  | "AUTONOMY_INSUFFICIENT"
  | "TOOL_NOT_ALLOWED"
  | "TOOL_BLOCKED_BY_POLICY"
  | "TOOL_UNKNOWN"
  | "RATE_LIMIT"
  | "RUN_LIMIT"
  | "ACTION_BUDGET_EXCEEDED"
  | "EXECUTION_WINDOW"
  | "DOMAIN_BLOCKED"
  | "BUDGET_EXCEEDED";

/** Workspace-level kill switch: the synthetic __kill_switch agent row disabled. */
export async function isWorkspaceKillSwitchEnabled(workspaceId: string): Promise<boolean> {
  const row = await db.query.agents.findFirst({
    where: and(eq(agents.workspaceId, workspaceId), eq(agents.agentKey, "__kill_switch")),
  });
  return Boolean(row && !row.enabled);
}

const READ_ONLY_TOOLS = new Set(
  Object.values(AGENT_TOOLS)
    .filter((t) => t.riskLevel === "LOW" && !t.requiresApproval)
    .map((t) => t.id)
);

/**
 * Can an agent at `autonomyLevel` call `toolId` without a mutation?
 * L0: read-only tools only.
 * L1: read-only + dry-run previews of risky tools (never executes mutations).
 * L2: everything except requires_approval tools — those still need approval.
 * L3: everything; requires_approval tools go through the approval flow.
 */
export function autonomyAllowsToolCall(autonomyLevel: number, toolId: string): { ok: boolean; needsApproval: boolean; reason?: string } {
  const t = getTool(toolId);
  if (!t) return { ok: false, needsApproval: false, reason: `Unknown tool "${toolId}"` };

  const wantsMutation = t.riskLevel !== "LOW" || t.requiresApproval;

  if (autonomyLevel <= 0 && wantsMutation) {
    return { ok: false, needsApproval: false, reason: `Agent autonomy L${autonomyLevel} (observe) cannot call mutation tool ${toolId}` };
  }
  if (autonomyLevel === 1 && wantsMutation) {
    // L1 may PREVIEW (dry-run) but never execute mutations.
    return { ok: true, needsApproval: true, reason: "L1 autonomy: mutations require dry-run or approval" };
  }
  if (t.requiresApproval) return { ok: true, needsApproval: true };
  return { ok: true, needsApproval: false };
}

/** Daily tool-call count for an agent (rate limiting). */
export async function getToolCallsToday(workspaceId: string, agentId: string, toolName: string): Promise<number> {
  const since = new Date(Date.now() - 24 * 3600 * 1000);
  const rows = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(agentRuns)
    .where(and(eq(agentRuns.workspaceId, workspaceId), eq(agentRuns.agentId, agentId), gte(agentRuns.createdAt, since)));
  // Tool-call granularity: approximate with runs (tools log inside run traces).
  void toolName;
  return rows[0]?.n ?? 0;
}

/** Runs started today for an agent (daily run limit). */
export async function getRunsToday(workspaceId: string, agentId: string): Promise<number> {
  const since = new Date();
  since.setHours(0, 0, 0, 0);
  const rows = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(agentRuns)
    .where(and(eq(agentRuns.workspaceId, workspaceId), eq(agentRuns.agentId, agentId), gte(agentRuns.createdAt, since)));
  return rows[0]?.n ?? 0;
}

/** Micro-USD spent today across all agents in the workspace (budget cap). */
export async function getWorkspaceSpendToday(workspaceId: string): Promise<number> {
  const since = new Date();
  since.setHours(0, 0, 0, 0);
  const rows = await db
    .select({ total: sql<number>`coalesce(sum(${agentUsage.estimatedCostMicroUsd}), 0)::int` })
    .from(agentUsage)
    .where(and(eq(agentUsage.workspaceId, workspaceId), gte(agentUsage.createdAt, since)));
  return rows[0]?.total ?? 0;
}

/** Micro-USD spent this calendar month across the workspace (monthly budget). */
export async function getWorkspaceSpendThisMonth(workspaceId: string): Promise<number> {
  const since = new Date();
  since.setDate(1);
  since.setHours(0, 0, 0, 0);
  const rows = await db
    .select({ total: sql<number>`coalesce(sum(${agentUsage.estimatedCostMicroUsd}), 0)::int` })
    .from(agentUsage)
    .where(and(eq(agentUsage.workspaceId, workspaceId), gte(agentUsage.createdAt, since)));
  return rows[0]?.total ?? 0;
}

/** Is the agent inside its execution window (workspace-local hours)? null window = 24/7. */
export function isWithinExecutionWindow(window: { start: number; end: number } | null): boolean {
  if (!window) return true;
  const hour = new Date().getHours();
  if (window.start <= window.end) return hour >= window.start && hour < window.end;
  // Overnight window (e.g. 22 → 6)
  return hour >= window.start || hour < window.end;
}

/** Full pre-run policy evaluation for an agent. */
export async function evaluateRunPolicy(workspaceId: string, agentKey: string): Promise<{ agent: typeof agents.$inferSelect } | { blocked: string; code: PolicyViolationCode }> {
  if (await isWorkspaceKillSwitchEnabled(workspaceId)) {
    return { blocked: "All agents are disabled by the workspace kill switch", code: "KILL_SWITCH" };
  }
  const agent = await db.query.agents.findFirst({
    where: and(eq(agents.workspaceId, workspaceId), eq(agents.agentKey, agentKey)),
  });
  if (!agent) return { blocked: `Agent "${agentKey}" is not provisioned in this workspace`, code: "AGENT_UNKNOWN" };
  if (agent.paused) return { blocked: `Agent "${agent.name}" is paused: ${agent.pauseReason ?? "policy action"}`, code: "AGENT_PAUSED" };
  if (!agent.enabled) return { blocked: `Agent "${agent.name}" is disabled`, code: "AGENT_DISABLED" };
  if (!isWithinExecutionWindow(agent.executionWindow)) {
    const w = agent.executionWindow;
    return { blocked: `Outside execution window (${w!.start}:00–${w!.end}:00)`, code: "EXECUTION_WINDOW" };
  }

  const runsToday = await getRunsToday(workspaceId, agent.id);
  if (agent.dailyRunLimit > 0 && runsToday >= agent.dailyRunLimit) {
    return { blocked: `Daily run limit reached (${agent.dailyRunLimit}/day)`, code: "RUN_LIMIT" };
  }

  const spendToday = await getWorkspaceSpendToday(workspaceId);
  if (agent.dailyBudgetMicroUsd > 0 && spendToday >= agent.dailyBudgetMicroUsd) {
    return { blocked: `Workspace daily AI budget exceeded ($${(spendToday / 1e6).toFixed(2)} spent)`, code: "BUDGET_EXCEEDED" };
  }

  const spendMonth = await getWorkspaceSpendThisMonth(workspaceId);
  if (agent.monthlyBudgetMicroUsd > 0 && spendMonth >= agent.monthlyBudgetMicroUsd) {
    return { blocked: `Workspace monthly AI budget exceeded ($${(spendMonth / 1e6).toFixed(2)} spent)`, code: "BUDGET_EXCEEDED" };
  }

  return { agent };
}

/** Per-tool-call policy evaluation. */
export async function evaluateToolPolicy(params: {
  workspaceId: string;
  agent: typeof agents.$inferSelect;
  toolId: string;
}): Promise<
  | { allowed: true; needsApproval: boolean }
  | { allowed: false; reason: string; code: PolicyViolationCode }
> {
  const { workspaceId, agent, toolId } = params;

  const t = getTool(toolId);
  if (!t) return { allowed: false, reason: `Unknown tool "${toolId}"`, code: "TOOL_UNKNOWN" };

  if (!agent.allowedTools.includes(toolId)) {
    return { allowed: false, reason: `Tool "${toolId}" is not in ${agent.name}'s allowlist`, code: "TOOL_NOT_ALLOWED" };
  }

  // Guardrail 2.0 — per-tool policy override wins over autonomy defaults.
  // "BLOCK" beats everything; "REQUIRE_APPROVAL" forces the approval path even
  // at L3; "ALLOW" bypasses autonomy-approval (still policy + audited).
  const override = agent.toolPolicies?.[toolId];
  if (override === "BLOCK") {
    return { allowed: false, reason: `Tool "${toolId}" is blocked by workspace policy`, code: "TOOL_BLOCKED_BY_POLICY" };
  }

  const autonomy = autonomyAllowsToolCall(agent.autonomyLevel, toolId);
  if (!autonomy.ok) {
    return { allowed: false, reason: autonomy.reason ?? "Autonomy level insufficient", code: "AUTONOMY_INSUFFICIENT" };
  }

  // Daily action budget (all tool calls by this agent).
  if (agent.maxActionsPerDay > 0) {
    const calls = await getToolCallsToday(workspaceId, agent.id, toolId);
    if (calls >= agent.maxActionsPerDay) {
      return { allowed: false, reason: `Agent action budget reached (${agent.maxActionsPerDay}/day)`, code: "ACTION_BUDGET_EXCEEDED" };
    }
  }

  // Rate limit per tool (stored on the agent config)
  const limit = agent.toolRateLimits?.[toolId];
  if (typeof limit === "number" && limit > 0) {
    const calls = await getToolCallsToday(workspaceId, agent.id, toolId);
    if (calls >= limit) {
      return { allowed: false, reason: `Rate limit reached for ${toolId} (${limit}/day)`, code: "RATE_LIMIT" };
    }
  }

  let needsApproval = autonomy.needsApproval;
  if (override === "REQUIRE_APPROVAL") needsApproval = true;
  if (override === "ALLOW") needsApproval = false;
  return { allowed: true, needsApproval };
}

/**
 * Domain guardrails for external-facing tools (research, communication).
 * Returns a blocked reason when the target domain is disallowed.
 */
export function evaluateDomainPolicy(
  agent: Pick<typeof agents.$inferSelect, "domainAllowlist" | "domainBlocklist">,
  urlOrEmail: string
): { ok: true } | { ok: false; reason: string } {
  const raw = urlOrEmail.toLowerCase();
  const domain = raw.includes("@")
    ? raw.split("@").pop()!.trim()
    : (() => {
        try {
          return new URL(raw.startsWith("http") ? raw : `https://${raw}`).hostname;
        } catch {
          return raw;
        }
      })();

  const blocked = (agent.domainBlocklist ?? []).some((d) => domain === d.toLowerCase() || domain.endsWith(`.${d.toLowerCase()}`));
  if (blocked) return { ok: false, reason: `Domain "${domain}" is blocklisted by workspace policy` };

  const allow = agent.domainAllowlist ?? [];
  if (allow.length > 0) {
    const allowed = allow.some((d) => domain === d.toLowerCase() || domain.endsWith(`.${d.toLowerCase()}`));
    if (!allowed) return { ok: false, reason: `Domain "${domain}" is not on the workspace allowlist` };
  }
  return { ok: true };
}

export { READ_ONLY_TOOLS };
