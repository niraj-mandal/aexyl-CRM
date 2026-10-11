/**
 * Discovery Engine orchestrator — the full daily pipeline.
 * Discover → normalize → dedup → verify websites → score → select top N →
 * create leads → notify → batch record.
 */

import { db } from "@/db";
import { discoveryBatches, discoveryCandidates, workspaces } from "@/db/schema";
import { and, eq, gte, sql } from "drizzle-orm";
import { OverpassDiscoveryProvider, hasContactSource, NO_CONTACT_REASON, type BusinessDiscoveryProvider } from "./provider";
import { GooglePlacesDiscoveryProvider } from "./google-places-provider";

export { NO_CONTACT_REASON };
import { normalizeProspects, deduplicateWithinBatch, deduplicateAgainstExisting, normalizeUrl } from "./normalizer";
import { WebsiteVerifier } from "./website-verifier";
import { DiscoveryScorer, type ScoringInput } from "./scoring";
import { LeadImportService, type ImportLeadCandidate } from "@/services/ai/lead-import.service";
import { NotificationService } from "@/services/notification.service";
import type { NormalizedCandidate } from "./normalizer";
import type { WebsiteCheckResult } from "./website-verifier";

export interface DiscoveryConfig {
  location: string;
  category: string;
  dailyTarget: number;
  minFitScore: number;
  queries?: string[];
  autoCreateLeads: boolean;
}

const DEFAULT_CONFIG: DiscoveryConfig = {
  location: "Jorhat, Assam, India",
  category: "gym",
  dailyTarget: 5,
  minFitScore: 30,
  autoCreateLeads: true,
};

export interface DiscoveryRunResult {
  batchId: string;
  runId: string;
  status: string;
  discovered: number;
  qualified: number;
  created: number;
  skipped: number;
  failed: number;
  notes: string[];
  errors: string[];
}

function generateRunId(config: DiscoveryConfig): string {
  const date = new Date().toISOString().slice(0, 10);
  const loc = config.location.split(",")[0].trim().toUpperCase().replace(/\s+/g, "-");
  const cat = config.category.toUpperCase();
  return `DISCOVERY-${loc}-${cat}-${date}`;
}

// Daily auto-discovery runs at 6:00 AM IST (UTC+5:30)
const DAILY_RUN_HOUR_IST = 6;

function isAfterDailyRunTime(): boolean {
  const now = new Date();
  // IST = UTC + 5:30
  const istHour = (now.getUTCHours() + 5 + Math.floor((now.getUTCMinutes() + 30) / 60)) % 24;
  return istHour >= DAILY_RUN_HOUR_IST;
}

export class DiscoveryOrchestrator {
  /**
   * Daily auto mode — called by cron tick. Only runs after 6 AM IST
   * and only once per day per workspace+category+location.
   */
  static async runDaily(
    workspaceId: string,
    userId: string,
    config?: Partial<DiscoveryConfig>,
  ): Promise<DiscoveryRunResult> {
    const saved = await DiscoveryOrchestrator.getSavedConfig(workspaceId);
    const cfg = { ...DEFAULT_CONFIG, ...saved, ...config };
    const runId = generateRunId(cfg);

    if (!isAfterDailyRunTime()) {
      return {
        batchId: "",
        runId,
        status: "SKIPPED",
        discovered: 0, qualified: 0, created: 0, skipped: 0, failed: 0,
        notes: ["Waiting for 6:00 AM IST to run daily discovery."],
        errors: [],
      };
    }

    const alreadyRan = await DiscoveryOrchestrator.hasRunToday(workspaceId, cfg);
    if (alreadyRan) {
      return {
        batchId: "",
        runId,
        status: "SKIPPED",
        discovered: 0, qualified: 0, created: 0, skipped: 0, failed: 0,
        notes: ["Daily discovery already completed for today."],
        errors: [],
      };
    }

    return DiscoveryOrchestrator.run(workspaceId, userId, cfg, runId);
  }

  static async runManual(
    workspaceId: string,
    userId: string,
    config?: Partial<DiscoveryConfig>,
  ): Promise<DiscoveryRunResult> {
    const cfg = { ...DEFAULT_CONFIG, ...config };
    const runId = generateRunId(cfg) + `-M${Date.now().toString(36).slice(-4)}`;
    return DiscoveryOrchestrator.run(workspaceId, userId, cfg, runId);
  }

  private static async run(
    workspaceId: string,
    userId: string,
    config: DiscoveryConfig,
    runId: string,
  ): Promise<DiscoveryRunResult> {
    const notes: string[] = [];
    const errors: string[] = [];
    const useGoogle = GooglePlacesDiscoveryProvider.isAvailable();
    const provider: BusinessDiscoveryProvider = useGoogle
      ? new GooglePlacesDiscoveryProvider()
      : new OverpassDiscoveryProvider();

    const [batch] = await db.insert(discoveryBatches).values({
      workspaceId,
      runId,
      location: config.location,
      category: config.category,
      provider: useGoogle ? "google_places" : "overpass",
      targetCount: config.dailyTarget,
      status: "RUNNING",
      config: config as unknown as Record<string, unknown>,
    }).returning();

    try {
      // 1. Discover
      const providerResult = await provider.search({
        category: config.category,
        city: config.location,
        queries: config.queries,
      });
      notes.push(...providerResult.notes);

      if (!providerResult.success || providerResult.prospects.length === 0) {
        await DiscoveryOrchestrator.finalizeBatch(batch.id, "FAILED", 0, 0, 0, 0, 0, errors);
        return { batchId: batch.id, runId, status: "FAILED", discovered: 0, qualified: 0, created: 0, skipped: 0, failed: 0, notes, errors };
      }

      // 2. Normalize
      const normalized = normalizeProspects(providerResult.prospects);
      notes.push(`${normalized.length} candidates after normalization.`);

      // 3. Dedup within batch
      const deduped = deduplicateWithinBatch(normalized);
      notes.push(`${deduped.length} after within-batch dedup.`);

      // 4. Dedup against existing CRM
      const { fresh, duplicates } = await deduplicateAgainstExisting(workspaceId, deduped);
      const skippedCount = duplicates.length;
      notes.push(`${fresh.length} fresh, ${skippedCount} already known.`);

      if (fresh.length === 0) {
        await DiscoveryOrchestrator.finalizeBatch(batch.id, "COMPLETED", providerResult.prospects.length, 0, 0, skippedCount, 0, errors);
        return { batchId: batch.id, runId, status: "COMPLETED", discovered: providerResult.prospects.length, qualified: 0, created: 0, skipped: skippedCount, failed: 0, notes, errors };
      }

      // 5. Verify websites
      const websiteResults = await WebsiteVerifier.verifyBatch(fresh.map((c) => c.website));
      notes.push(`Website verification complete.`);

      // 6. Score
      const scored = fresh.map((c, i) => {
        const ws = websiteResults[i];
        const scoringInput: ScoringInput = {
          businessName: c.businessName,
          category: c.category,
          targetCategory: config.category,
          address: c.address,
          city: c.city,
          targetCity: config.location,
          latitude: c.latitude,
          longitude: c.longitude,
          phone: c.phone,
          email: c.email,
          socials: c.socials,
          website: c.website,
          websiteStatus: ws.status,
          openingHours: c.openingHours,
          matchedTag: c.matchedTag,
        };
        const result = DiscoveryScorer.score(scoringInput);
        const contactable = hasContactSource(c);
        const rejectedReason = !DiscoveryScorer.qualifies(result, config.minFitScore)
          ? `Score ${result.totalScore} below minimum ${config.minFitScore}`
          : !contactable
            ? NO_CONTACT_REASON
            : null;
        return { candidate: c, website: ws, scoring: result, rejectedReason };
      });

      // 7. Filter qualified (must be contactable) and sort by total score
      const qualified = scored
        .filter((s) => s.rejectedReason === null)
        .sort((a, b) => b.scoring.totalScore - a.scoring.totalScore);

      const noContact = scored.filter((s) => s.rejectedReason === NO_CONTACT_REASON).length;
      notes.push(`${qualified.length} qualified (min score ${config.minFitScore}, contact required); ${noContact} skipped for no phone/email/social.`);

      // 8. Select top N
      const selected = qualified.slice(0, config.dailyTarget);

      // 9. Save all candidates to DB (including non-selected for audit)
      for (const s of scored) {
        const isSelected = selected.includes(s);
        await db.insert(discoveryCandidates).values({
          workspaceId,
          batchId: batch.id,
          externalId: s.candidate.externalId,
          source: s.candidate.source,
          businessName: s.candidate.businessName ?? "Unknown",
          normalizedName: s.candidate.normalizedName,
          category: s.candidate.category,
          address: s.candidate.address,
          city: s.candidate.city,
          state: s.candidate.state,
          country: s.candidate.country,
          latitude: s.candidate.latitude,
          longitude: s.candidate.longitude,
          phone: s.candidate.phone,
          normalizedPhone: s.candidate.normalizedPhone,
          website: s.candidate.website,
          normalizedDomain: s.candidate.normalizedDomain,
          sourceUrl: s.candidate.sourceUrl,
          websiteStatus: s.website.status,
          websiteUrl: s.website.url,
          websiteCheckedAt: new Date(),
          websiteCheckReason: s.website.reason,
          fitScore: s.scoring.fitScore,
          opportunityScore: s.scoring.opportunityScore,
          qualificationStatus: isSelected
            ? (config.autoCreateLeads ? "QUALIFIED" : "PENDING")
            : (s.rejectedReason === null ? "PENDING" : "REJECTED"),
          reasons: s.scoring.reasons,
          gaps: s.scoring.gaps,
          discoveryMetadata: {
            matchedTag: s.candidate.matchedTag,
            openingHours: s.candidate.openingHours,
            totalScore: s.scoring.totalScore,
            email: s.candidate.email,
            socials: s.candidate.socials,
          },
          rejectedReason: s.rejectedReason,
        }).onConflictDoNothing();
      }

      // 10. Create CRM leads for auto-create candidates
      let createdCount = 0;
      let failedCount = 0;

      if (config.autoCreateLeads) {
        for (const s of selected) {
          try {
            const importCandidate: ImportLeadCandidate = {
              companyName: s.candidate.businessName ?? "Unknown",
              website: normalizeUrl(s.candidate.website),
              industry: s.candidate.category,
              location: s.candidate.address,
              size: s.candidate.matchedTag,
              description: null,
              emails: s.candidate.email ? [s.candidate.email] : [],
              phones: s.candidate.phone ? [s.candidate.phone] : [],
              linkedin: null,
              fitScore: s.scoring.totalScore,
              sourceQuery: s.candidate.sourceQuery,
              sourceUrl: s.candidate.sourceUrl,
              placeId: s.candidate.externalId,
              priority: s.scoring.opportunityScore >= 24 ? "Hot" : s.scoring.opportunityScore >= 10 ? "Warm" : "Cold",
              priorityReason: s.scoring.reasons.join("; "),
              hook: null,
            };

            const result = await LeadImportService.importCandidate(workspaceId, userId, importCandidate);
            if (result.ok && !result.skipped) {
              createdCount++;
              await db
                .update(discoveryCandidates)
                .set({
                  qualificationStatus: "IMPORTED",
                  leadId: result.leadId,
                  companyId: result.companyId,
                })
                .where(
                  and(
                    eq(discoveryCandidates.batchId, batch.id),
                    eq(discoveryCandidates.externalId, s.candidate.externalId),
                  ),
                );
            } else if (result.skipped) {
              await db
                .update(discoveryCandidates)
                .set({ qualificationStatus: "REJECTED", rejectedReason: "Already in CRM (import dedup)" })
                .where(
                  and(
                    eq(discoveryCandidates.batchId, batch.id),
                    eq(discoveryCandidates.externalId, s.candidate.externalId),
                  ),
                );
            } else {
              failedCount++;
              errors.push(`Import failed for ${s.candidate.businessName}: ${result.error}`);
            }
          } catch (err) {
            failedCount++;
            errors.push(`Import error for ${s.candidate.businessName}: ${err instanceof Error ? err.message : "unknown"}`);
          }
        }
      }

      // 11. Finalize batch
      const finalStatus = failedCount === selected.length && selected.length > 0
        ? "FAILED"
        : failedCount > 0
          ? "PARTIAL_SUCCESS"
          : "COMPLETED";

      await DiscoveryOrchestrator.finalizeBatch(
        batch.id, finalStatus,
        providerResult.prospects.length, qualified.length,
        createdCount, skippedCount, failedCount, errors,
      );

      // 12. Notify
      if (createdCount > 0) {
        await NotificationService.notifyWorkspace({
          workspaceId,
          type: "DISCOVERY",
          title: `${createdCount} new lead${createdCount > 1 ? "s" : ""} discovered`,
          body: `Discovery Engine found ${createdCount} new ${config.category} lead${createdCount > 1 ? "s" : ""} in ${config.location}.`,
          link: "/bdr?tab=discovery",
          dedupeKey: `discovery-${runId}`,
        });
      }

      notes.push(`Batch ${finalStatus}: ${createdCount} created, ${skippedCount} skipped, ${failedCount} failed.`);

      return {
        batchId: batch.id,
        runId,
        status: finalStatus,
        discovered: providerResult.prospects.length,
        qualified: qualified.length,
        created: createdCount,
        skipped: skippedCount,
        failed: failedCount,
        notes,
        errors,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : "unknown error";
      errors.push(msg);
      await DiscoveryOrchestrator.finalizeBatch(batch.id, "FAILED", 0, 0, 0, 0, 0, errors);
      return { batchId: batch.id, runId, status: "FAILED", discovered: 0, qualified: 0, created: 0, skipped: 0, failed: 0, notes, errors };
    }
  }

  static async getSavedConfig(workspaceId: string): Promise<Partial<DiscoveryConfig>> {
    const [ws] = await db
      .select({ discoveryConfig: workspaces.discoveryConfig })
      .from(workspaces)
      .where(eq(workspaces.id, workspaceId))
      .limit(1);
    return ws?.discoveryConfig ?? {};
  }

  static async saveConfig(
    workspaceId: string,
    config: { location: string; category: string; dailyTarget: number },
  ): Promise<void> {
    await db
      .update(workspaces)
      .set({ discoveryConfig: config, updatedAt: new Date() })
      .where(eq(workspaces.id, workspaceId));
  }

  private static async hasRunToday(workspaceId: string, config: DiscoveryConfig): Promise<boolean> {
    const IST_OFFSET_MS = 330 * 60_000;
    const istNow = Date.now() + IST_OFFSET_MS;
    const todayStart = new Date(istNow - (istNow % 86_400_000) - IST_OFFSET_MS);

    const [existing] = await db
      .select({ id: discoveryBatches.id })
      .from(discoveryBatches)
      .where(and(
        eq(discoveryBatches.workspaceId, workspaceId),
        eq(discoveryBatches.category, config.category),
        eq(discoveryBatches.location, config.location),
        gte(discoveryBatches.startedAt, todayStart),
        sql`${discoveryBatches.status} != 'FAILED'`,
      ))
      .limit(1);

    return !!existing;
  }

  private static async finalizeBatch(
    batchId: string,
    status: string,
    discovered: number,
    qualified: number,
    created: number,
    skipped: number,
    failed: number,
    errors: string[],
  ) {
    await db
      .update(discoveryBatches)
      .set({
        status,
        discoveredCount: discovered,
        qualifiedCount: qualified,
        createdCount: created,
        skippedCount: skipped,
        failedCount: failed,
        errors: errors.length > 0 ? errors : null,
        completedAt: new Date(),
      })
      .where(eq(discoveryBatches.id, batchId));
  }
}
