"use server";

import { requireWorkspace } from "@/lib/auth/workspace";
import { db } from "@/db";
import { discoveryBatches, discoveryCandidates, leads } from "@/db/schema";
import { and, eq, desc } from "drizzle-orm";
import { DiscoveryOrchestrator, type DiscoveryConfig } from "@/services/discovery/orchestrator";
import { LeadImportService, type ImportLeadCandidate } from "@/services/ai/lead-import.service";
import { normalizeUrl } from "@/services/discovery/normalizer";
import { revalidatePath } from "next/cache";

type CandidateRow = typeof discoveryCandidates.$inferSelect;

function candidateContacts(c: CandidateRow): { email: string | null; socials: string[] } {
  const meta = (c.discoveryMetadata ?? {}) as { email?: string | null; socials?: string[] };
  return { email: meta.email ?? null, socials: Array.isArray(meta.socials) ? meta.socials : [] };
}

function contactScore(c: CandidateRow): number {
  const { email, socials } = candidateContacts(c);
  return (c.phone ? 2 : 0) + (email ? 1 : 0) + (socials.length > 0 ? 1 : 0);
}

function sortContactableFirst(rows: CandidateRow[]): CandidateRow[] {
  return [...rows].sort(
    (a, b) =>
      contactScore(b) - contactScore(a) ||
      b.fitScore + b.opportunityScore - (a.fitScore + a.opportunityScore),
  );
}

export async function runDiscoveryAction(config?: Partial<DiscoveryConfig>) {
  const { workspaceId, userId } = await requireWorkspace();
  const result = await DiscoveryOrchestrator.runManual(workspaceId, userId, config);
  revalidatePath("/bdr");
  return result;
}

export async function getDiscoveryOverviewAction() {
  const { workspaceId } = await requireWorkspace();
  const [recentBatches, pending, settings] = await Promise.all([
    db
      .select()
      .from(discoveryBatches)
      .where(eq(discoveryBatches.workspaceId, workspaceId))
      .orderBy(desc(discoveryBatches.createdAt))
      .limit(30),
    db
      .select()
      .from(discoveryCandidates)
      .where(
        and(
          eq(discoveryCandidates.workspaceId, workspaceId),
          eq(discoveryCandidates.qualificationStatus, "PENDING"),
        ),
      )
      .orderBy(desc(discoveryCandidates.fitScore)),
    DiscoveryOrchestrator.getSavedConfig(workspaceId),
  ]);

  return {
    stats: {
      totalBatches: recentBatches.length,
      totalDiscovered: recentBatches.reduce((sum, b) => sum + b.discoveredCount, 0),
      totalQualified: recentBatches.reduce((sum, b) => sum + b.qualifiedCount, 0),
      totalCreated: recentBatches.reduce((sum, b) => sum + b.createdCount, 0),
      pendingReview: pending.length,
      lastBatch: recentBatches[0] ?? null,
    },
    candidates: sortContactableFirst(pending),
    batches: recentBatches.slice(0, 20),
    settings,
  };
}

export async function getDiscoverySettingsAction() {
  const { workspaceId } = await requireWorkspace();
  return DiscoveryOrchestrator.getSavedConfig(workspaceId);
}

export async function saveDiscoverySettingsAction(input: {
  location: string;
  category: string;
  dailyTarget: number;
  rotation?: string[];
}) {
  const { workspaceId } = await requireWorkspace();
  const rotation = (Array.isArray(input.rotation) ? input.rotation : [])
    .map((c) => String(c ?? "").trim().slice(0, 200))
    .filter(Boolean)
    .slice(0, 30);
  const location = String(input.location ?? "").trim().slice(0, 200);
  const category = String(input.category ?? "").trim().toLowerCase().slice(0, 50);
  const dailyTarget = Math.round(Number(input.dailyTarget));
  if (!location || !category) return { error: "Location and category are required." };
  if (!Number.isFinite(dailyTarget) || dailyTarget < 1 || dailyTarget > 25) {
    return { error: "Daily target must be between 1 and 25." };
  }
  await DiscoveryOrchestrator.saveConfig(workspaceId, { location, category, dailyTarget, rotation });
  revalidatePath("/bdr");
  return { ok: true as const };
}

export async function getDiscoveryBatchesAction(limit = 20) {
  const { workspaceId } = await requireWorkspace();
  return db
    .select()
    .from(discoveryBatches)
    .where(eq(discoveryBatches.workspaceId, workspaceId))
    .orderBy(desc(discoveryBatches.createdAt))
    .limit(limit);
}

export async function getDiscoveryCandidatesAction(batchId: string) {
  const { workspaceId } = await requireWorkspace();
  return db
    .select()
    .from(discoveryCandidates)
    .where(
      and(
        eq(discoveryCandidates.workspaceId, workspaceId),
        eq(discoveryCandidates.batchId, batchId),
      ),
    )
    .orderBy(desc(discoveryCandidates.fitScore));
}

export async function getPendingCandidatesAction() {
  const { workspaceId } = await requireWorkspace();
  return db
    .select()
    .from(discoveryCandidates)
    .where(
      and(
        eq(discoveryCandidates.workspaceId, workspaceId),
        eq(discoveryCandidates.qualificationStatus, "PENDING"),
      ),
    )
    .orderBy(desc(discoveryCandidates.fitScore));
}

export async function approveCandidateAction(candidateId: string) {
  const { workspaceId, userId } = await requireWorkspace();

  const [candidate] = await db
    .select()
    .from(discoveryCandidates)
    .where(
      and(
        eq(discoveryCandidates.id, candidateId),
        eq(discoveryCandidates.workspaceId, workspaceId),
      ),
    )
    .limit(1);

  if (!candidate) return { error: "Candidate not found." };
  if (candidate.qualificationStatus === "IMPORTED") return { error: "Already imported." };

  const importCandidate: ImportLeadCandidate = {
    companyName: candidate.businessName,
    website: normalizeUrl(candidate.website),
    industry: candidate.category,
    location: candidate.address,
    size: null,
    description: null,
    emails: candidateContacts(candidate).email ? [candidateContacts(candidate).email!] : [],
    phones: candidate.phone ? [candidate.phone] : [],
    linkedin: null,
    fitScore: candidate.fitScore + candidate.opportunityScore,
    sourceQuery: candidate.sourceUrl ?? "",
    sourceUrl: candidate.sourceUrl,
    placeId: candidate.externalId ?? undefined,
    priority: candidate.opportunityScore >= 24 ? "Hot" : candidate.opportunityScore >= 10 ? "Warm" : "Cold",
    priorityReason: Array.isArray(candidate.reasons) ? (candidate.reasons as string[]).join("; ") : null,
  };

  const result = await LeadImportService.importCandidate(workspaceId, userId, importCandidate);
  if (!result.ok) return { error: result.error ?? "Import failed." };

  await db
    .update(discoveryCandidates)
    .set({
      qualificationStatus: "IMPORTED",
      leadId: result.leadId,
      companyId: result.companyId,
    })
    .where(eq(discoveryCandidates.id, candidateId));

  revalidatePath("/bdr");
  return { ok: true, leadId: result.leadId };
}

export async function rejectCandidateAction(candidateId: string, reason?: string) {
  const { workspaceId } = await requireWorkspace();

  await db
    .update(discoveryCandidates)
    .set({
      qualificationStatus: "REJECTED",
      rejectedReason: reason?.slice(0, 500) || "Manually rejected",
    })
    .where(
      and(
        eq(discoveryCandidates.id, candidateId),
        eq(discoveryCandidates.workspaceId, workspaceId),
      ),
    );

  revalidatePath("/bdr");
  return { ok: true };
}

export async function getDiscoveryStatsAction() {
  const { workspaceId } = await requireWorkspace();

  const batches = await db
    .select()
    .from(discoveryBatches)
    .where(eq(discoveryBatches.workspaceId, workspaceId))
    .orderBy(desc(discoveryBatches.createdAt))
    .limit(30);

  const totalDiscovered = batches.reduce((sum, b) => sum + b.discoveredCount, 0);
  const totalCreated = batches.reduce((sum, b) => sum + b.createdCount, 0);
  const totalQualified = batches.reduce((sum, b) => sum + b.qualifiedCount, 0);

  const pendingCandidates = await db
    .select({ id: discoveryCandidates.id })
    .from(discoveryCandidates)
    .where(
      and(
        eq(discoveryCandidates.workspaceId, workspaceId),
        eq(discoveryCandidates.qualificationStatus, "PENDING"),
      ),
    );

  const lastBatch = batches[0] ?? null;

  return {
    totalBatches: batches.length,
    totalDiscovered,
    totalQualified,
    totalCreated,
    pendingReview: pendingCandidates.length,
    lastBatch,
  };
}
