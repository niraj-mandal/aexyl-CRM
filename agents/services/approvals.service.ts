/**
 * Approvals Service — the human-in-the-loop gate. Agents request; humans
 * decide; the service executes approved tool calls exactly once.
 *
 * Idempotency: the approval row itself is the receipt — status transitions
 * PENDING → APPROVED → EXECUTED are enforced with conditional UPDATEs, so
 * double-clicks or replays cannot execute a tool twice.
 */
import { db } from "@/db";
import { agentApprovals, agents, agentRuns, incidents } from "@/db/schema";
import { NotificationService } from "@/services/notification.service";
import { and, eq, inArray, lt, sql } from "drizzle-orm";
import { getTool } from "../core/registry/tools";
import { ActivityService } from "@/services/activity.service";

export type ApprovalOutcome =
  | { ok: true; message: string; result?: unknown }
  | { ok: false; message: string };

/** Mark expired approvals (cheap, call on list/read paths). */
export async function expireStaleApprovals(workspaceId: string) {
  await db
    .update(agentApprovals)
    .set({ status: "EXPIRED" })
    .where(
      and(
        eq(agentApprovals.workspaceId, workspaceId),
        eq(agentApprovals.status, "PENDING"),
        lt(agentApprovals.expiresAt, new Date())
      )
    );
}

export async function approveAndExecute(params: {
  workspaceId: string;
  approvalId: string;
  reviewedBy: string;
  dryRun?: boolean;
}): Promise<ApprovalOutcome> {
  const { workspaceId, approvalId, reviewedBy, dryRun = false } = params;

  // Conditional transition: only a PENDING row can become APPROVED.
  const [claimed] = await db
    .update(agentApprovals)
    .set({ status: "APPROVED", reviewedBy, reviewedAt: new Date() })
    .where(
      and(
        eq(agentApprovals.id, approvalId),
        eq(agentApprovals.workspaceId, workspaceId),
        eq(agentApprovals.status, "PENDING")
      )
    )
    .returning();

  if (!claimed) {
    const existing = await db.query.agentApprovals.findFirst({ where: eq(agentApprovals.id, approvalId) });
    return { ok: false, message: existing ? `Approval is ${existing.status} — already handled.` : "Approval not found." };
  }

  await ActivityService.logAudit(workspaceId, reviewedBy, "APPROVAL_APPROVED", "AGENT_APPROVAL", approvalId, {
    toolName: claimed.toolName,
    runId: claimed.runId,
  });

  if (dryRun) {
    return { ok: true, message: "Approved (dry-run): tool NOT executed.", result: { dryRun: true } };
  }

  const t = getTool(claimed.toolName);
  if (!t) {
    await db.update(agentApprovals).set({ status: "CANCELLED", executionResult: { error: "tool no longer exists" } }).where(eq(agentApprovals.id, approvalId));
    return { ok: false, message: "Approved tool no longer exists." };
  }

  // Execute with the run context recorded on the approval.
  const runId = claimed.runId ?? "approval-direct";
  try {
    const result = await t.execute(claimed.proposedArguments, {
      workspaceId,
      userId: reviewedBy,
      runId,
      dryRun: false,
    });

    // Conditional transition to EXECUTED — idempotency receipt.
    await db
      .update(agentApprovals)
      .set({ status: "EXECUTED", executionResult: result as Record<string, unknown> })
      .where(and(eq(agentApprovals.id, approvalId), eq(agentApprovals.status, "APPROVED")));

    await ActivityService.logAudit(workspaceId, reviewedBy, "AGENT_ACTION_EXECUTED", "AGENT_APPROVAL", approvalId, {
      toolName: claimed.toolName,
      runId,
      result: typeof result === "object" ? result : String(result),
    });

    return { ok: true, message: `${t.name} executed.`, result };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Tool execution failed";
    // Keep APPROVED but record the failure — the human decision stands.
    await db
      .update(agentApprovals)
      .set({ executionResult: { error: message.slice(0, 400) } })
      .where(eq(agentApprovals.id, approvalId));
    await ActivityService.logAudit(workspaceId, reviewedBy, "TOOL_FAILED", "AGENT_APPROVAL", approvalId, {
      toolName: claimed.toolName,
      error: message.slice(0, 300),
    });
    return { ok: false, message: `Approved but execution failed: ${message}` };
  }
}

export async function rejectApproval(params: {
  workspaceId: string;
  approvalId: string;
  reviewedBy: string;
}): Promise<ApprovalOutcome> {
  const [rejected] = await db
    .update(agentApprovals)
    .set({ status: "REJECTED", reviewedBy: params.reviewedBy, reviewedAt: new Date() })
    .where(
      and(
        eq(agentApprovals.id, params.approvalId),
        eq(agentApprovals.workspaceId, params.workspaceId),
        eq(agentApprovals.status, "PENDING")
      )
    )
    .returning();

  if (!rejected) {
    const existing = await db.query.agentApprovals.findFirst({ where: eq(agentApprovals.id, params.approvalId) });
    return { ok: false, message: existing ? `Approval is ${existing.status}.` : "Approval not found." };
  }

  await ActivityService.logAudit(params.workspaceId, params.reviewedBy, "APPROVAL_REJECTED", "AGENT_APPROVAL", params.approvalId, {
    toolName: rejected.toolName,
    runId: rejected.runId,
  });

  // If the parent run is waiting on approvals and everything is resolved, fail it gracefully.
  if (rejected.runId) {
    const remaining = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(agentApprovals)
      .where(and(eq(agentApprovals.runId, rejected.runId), eq(agentApprovals.status, "PENDING")));
    if ((remaining[0]?.n ?? 0) === 0) {
      await db.execute(sql`UPDATE agent_runs SET status='COMPLETED', completed_at=now(), result = coalesce(result, '{}'::jsonb) || '{"rejected":true}'::jsonb WHERE id = ${rejected.runId} AND status='AWAITING_APPROVAL'`);
    }
  }

  return { ok: true, message: "Rejected. No action was taken." };
}

export async function cancelApproval(params: {
  workspaceId: string;
  approvalId: string;
  reviewedBy: string;
}): Promise<ApprovalOutcome> {
  const [cancelled] = await db
    .update(agentApprovals)
    .set({ status: "CANCELLED", reviewedBy: params.reviewedBy, reviewedAt: new Date() })
    .where(
      and(
        eq(agentApprovals.id, params.approvalId),
        eq(agentApprovals.workspaceId, params.workspaceId),
        eq(agentApprovals.status, "PENDING")
      )
    )
    .returning();
  if (!cancelled) return { ok: false, message: "Only pending approvals can be cancelled." };
  await ActivityService.logAudit(params.workspaceId, params.reviewedBy, "APPROVAL_CANCELLED", "AGENT_APPROVAL", params.approvalId, {
    toolName: cancelled.toolName,
  });
  return { ok: true, message: "Cancelled." };
}

/** Workspace kill switch — engages/disengages the marker row. */
export async function setKillSwitch(workspaceId: string, userId: string, engaged: boolean) {
  await db
    .update(agents)
    .set({ enabled: engaged ? false : true, updatedAt: new Date() })
    .where(and(eq(agents.workspaceId, workspaceId), eq(agents.agentKey, "__kill_switch")));

  if (engaged) {
    // Stop queued/early-stage runs immediately.
    await db
      .update(agentRuns)
      .set({ status: "CANCELLED", completedAt: new Date() })
      .where(
        and(
          eq(agentRuns.workspaceId, workspaceId),
          inArray(agentRuns.status, ["QUEUED", "INITIALIZING", "CONTEXT_LOADING", "PLANNING"])
        )
      );
    // Incident trail (spec §29): kill switch = an incident worth recording.
    await db.insert(incidents).values({
      workspaceId,
      title: "Kill switch engaged — all agents disabled",
      description: "Emergency stop activated. Review recent agent activity and audit logs before re-enabling.",
      status: "OPEN",
      severity: "SEV1",
      source: "system",
      metadata: { kind: "kill_switch", engagedBy: userId },
    });
  }

  await ActivityService.logAudit(workspaceId, userId, engaged ? "AGENT_KILL_SWITCH_ENABLED" : "AGENT_KILL_SWITCH_DISABLED", "WORKSPACE", workspaceId, {
    scope: "all_agents",
  });

  // Alert the whole workspace except the actor (spec §23 — actionable, deduped).
  await NotificationService.notifyWorkspace({
    workspaceId,
    exceptUserId: userId,
    type: "agent.kill_switch",
    title: engaged ? "All agents disabled (kill switch)" : "Agents re-enabled",
    body: engaged
      ? "An operator engaged the emergency stop. Pending approvals remain visible."
      : "Agent autonomy restored.",
    link: "/agents",
    dedupeKey: engaged ? "kill-switch-engaged" : undefined,
  });
}
