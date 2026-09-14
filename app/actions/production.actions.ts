"use server";

import { requireWorkspace } from "@/lib/auth/workspace";
import { db } from "@/db";
import { agentFeedback, agentRuns, agentApprovals, incidents, leads } from "@/db/schema";
import { and, eq, gte, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import {
  getConnector,
  markConnected,
  markDisconnected,
  verifyConnection,
} from "@/services/integrations/registry";
import { setFlag } from "@/lib/flags";
import { NotificationService } from "@/services/notification.service";
import { reapStaleRuns, detectFailureSpikes } from "@/agents/core/runtime/reaper";
import { logger } from "@/lib/logger";

// --- integrations -----------------------------------------------------------

export async function connectConnectorAction(connectorKey: string, accountLabel?: string) {
  const { workspaceId, userId } = await requireWorkspace();
  const connector = getConnector(connectorKey);
  if (!connector) return { ok: false as const, error: "Unknown connector" };
  if (!connector.isConfigurable(process.env)) {
    return { ok: false as const, error: connector.requiresExternalSetup ? connector.setupHint : `Missing configuration: ${connector.setupHint}` };
  }
  await markConnected({
    workspaceId,
    connectorKey,
    accountLabel,
    metadata: { connectedBy: userId, scopes: connector.scopes },
  });
  const v = await verifyConnection(workspaceId, connectorKey);
  revalidatePath("/settings/integrations");
  return v.ok ? { ok: true as const } : { ok: false as const, error: v.error ?? "Connection check failed" };
}

export async function disconnectConnectorAction(connectorKey: string) {
  const { workspaceId } = await requireWorkspace();
  await markDisconnected(workspaceId, connectorKey);
  revalidatePath("/settings/integrations");
  return { ok: true as const };
}

export async function verifyConnectorAction(connectorKey: string) {
  const { workspaceId } = await requireWorkspace();
  const result = await verifyConnection(workspaceId, connectorKey);
  revalidatePath("/settings/integrations");
  return result;
}

// --- feature flags -----------------------------------------------------------

export async function toggleFlagAction(flagKey: string, enabled: boolean) {
  const { workspaceId } = await requireWorkspace();
  await setFlag(workspaceId, flagKey, enabled);
  revalidatePath("/settings/integrations");
  return { ok: true as const };
}

// --- notifications -----------------------------------------------------------

export async function listNotificationsAction() {
  const { workspaceId, userId } = await requireWorkspace();
  const [items, unread] = await Promise.all([
    NotificationService.list(workspaceId, userId, 20),
    NotificationService.unreadCount(workspaceId, userId),
  ]);
  return { items, unread };
}

export async function markNotificationsReadAction(notificationId?: string) {
  const { workspaceId, userId } = await requireWorkspace();
  await NotificationService.markRead(workspaceId, userId, notificationId);
  revalidatePath("/", "layout");
  return { ok: true as const };
}

// --- agent feedback (spec §27) ------------------------------------------------

export async function submitRunFeedbackAction(runId: string, rating: "HELPFUL" | "NOT_HELPFUL", comment?: string) {
  const { workspaceId, userId } = await requireWorkspace();
  const run = await db.query.agentRuns.findFirst({
    where: and(eq(agentRuns.id, runId), eq(agentRuns.workspaceId, workspaceId)),
  });
  if (!run) return { ok: false as const, error: "Run not found" };
  await db.insert(agentFeedback).values({
    workspaceId,
    runId,
    agentId: run.agentId,
    userId,
    rating,
    comment: comment?.slice(0, 500),
  });
  revalidatePath(`/agents/runs/${runId}`);
  return { ok: true as const };
}

// --- incidents -----------------------------------------------------------------

export async function resolveIncidentAction(incidentId: string, note?: string) {
  const { workspaceId, userId } = await requireWorkspace();
  const [updated] = await db
    .update(incidents)
    .set({ status: "RESOLVED", resolvedAt: new Date(), updatedAt: new Date(), metadata: { resolvedBy: userId, note: note?.slice(0, 300) ?? null } })
    .where(and(eq(incidents.id, incidentId), eq(incidents.workspaceId, workspaceId)))
    .returning();
  if (updated) {
    await NotificationService.notifyWorkspace({
      workspaceId,
      type: "incident.resolved",
      title: `Incident resolved: ${updated.title}`,
      link: "/agents/observability",
    });
  }
  revalidatePath("/agents/observability");
  return { ok: Boolean(updated) };
}

// --- reliability -----------------------------------------------------------------

/** Runs the reaper + failure-spike detection; wired into agents page loads. */
export async function runReliabilitySweepAction() {
  const { workspaceId } = await requireWorkspace();
  const summary = await reapStaleRuns(workspaceId);
  const spikes = await detectFailureSpikes(workspaceId);
  if (summary.escalated.length > 0 || spikes.opened) {
    logger.warn("reliability sweep found issues", { ...summary, spikes });
  }
  return { ...summary, spikes };
}

// --- daily operating brief (spec §20) ------------------------------------------

export async function getDailyBriefAction() {
  const { workspaceId } = await requireWorkspace();
  const { getRevenueIntelligence, getPredictiveRisks } = await import("@/services/revenue-intelligence.service");
  const since24h = new Date(Date.now() - 24 * 3600 * 1000);

  const [rev, risks, staleLeads, recentRuns, openApprovals] = await Promise.all([
    getRevenueIntelligence(workspaceId),
    getPredictiveRisks(workspaceId),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(leads)
      .where(and(eq(leads.workspaceId, workspaceId), sql`${leads.updatedAt} < now() - interval '7 days'`, sql`${leads.status} not in ('CONVERTED','LOST','UNQUALIFIED')`)),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(agentRuns)
      .where(and(eq(agentRuns.workspaceId, workspaceId), gte(agentRuns.createdAt, since24h))),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(agentApprovals)
      .where(and(eq(agentApprovals.workspaceId, workspaceId), eq(agentApprovals.status, "PENDING"))),
  ]);

  return {
    generatedAt: new Date().toISOString(),
    revenue: {
      openPipeline: Math.round(rev.openPipelineValue),
      weighted: Math.round(rev.weightedPipelineValue),
      won90d: Math.round(rev.wonValue90d),
      winRate: rev.winRate === null ? null : Math.round(rev.winRate * 100),
      forecast30d: rev.forecast30d === null ? null : Math.round(rev.forecast30d),
      forecastMethod: rev.forecastMethod,
    },
    priorities: [
      ...risks.slice(0, 2).map((r) => ({
        label: r.kind === "DEAL" ? `Deal at close-slip risk: ${r.name}` : `Project may be slipping: ${r.name}`,
        detail: r.evidence.join(" · "),
        href: r.kind === "DEAL" ? "/pipeline" : "/projects",
      })),
      ...(staleLeads[0]?.n > 0
        ? [{ label: `${staleLeads[0].n} leads untouched 7+ days`, detail: "Run the Follow-up sweep", href: "/my-day" }]
        : []),
      ...(openApprovals[0]?.n > 0
        ? [{ label: `${openApprovals[0].n} agent approvals pending`, detail: "Review in Approval Center", href: "/agents/approvals" }]
        : []),
    ],
    agentRuns24h: recentRuns[0]?.n ?? 0,
    evidence: rev.evidence,
  };
}
