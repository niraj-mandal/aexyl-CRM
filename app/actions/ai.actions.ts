"use server";

import { requireWorkspace, requireAdmin } from "@/lib/auth/workspace";
import { AiAgentService, type CopilotTurn } from "@/services/ai/ai-agent.service";
import { LeadDiscoveryService, type DiscoveredLead } from "@/services/ai/lead-discovery.service";
import { LocalLeadDiscoveryService } from "@/services/ai/local-lead-discovery.service";
import { GooglePlacesDiscoveryService } from "@/services/ai/google-places-discovery.service";
import { GoogleMapsScraperService } from "@/services/ai/google-maps-scraper.service";
import { LeadEnrichmentService, type EnrichmentResult } from "@/services/ai/lead-enrichment.service";
import { CampaignAnalyticsService, type CampaignOverview } from "@/services/ai/campaign-analytics.service";
import {
  CopilotWriteService,
  isWriteKind,
  normalizeWriteProposal,
  summarizeProposal,
  type CopilotWriteResult,
} from "@/services/ai/copilot-writes";
import { SheetImportService, type SheetParseResult } from "@/services/ai/sheet-import.service";
import { LeadImportService, type ImportLeadCandidate } from "@/services/ai/lead-import.service";
import { revalidatePath } from "next/cache";
import type { LlmImage } from "@/services/ai/llm.service";

/** Re-exported for existing consumers (drawer); implementation lives in services/ai/lead-import. */
export type { ImportLeadCandidate } from "@/services/ai/lead-import.service";

/** Fresh audit (explicit "Run audit"). Read-only, so no revalidation: that re-rendered the whole page. */
export async function runPipelineStrategicAuditAction() {
  const { workspaceId } = await requireAdmin();
  return AiAgentService.auditPipelineRiskCached(workspaceId, 0);
}

/** Recent audit for passive views (Daily brief): reuses a result up to 5 minutes old. */
export async function getPipelineAuditAction() {
  const { workspaceId } = await requireAdmin();
  return AiAgentService.auditPipelineRiskCached(workspaceId);
}

export async function enrichLeadAiAction(leadId: string) {
  const { workspaceId } = await requireWorkspace();
  return await AiAgentService.enrichAndScoreLead(workspaceId, leadId);
}

interface HistoryTurnInput {
  role?: unknown;
  text?: unknown;
}

const COPILOT_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const COPILOT_MAX_IMAGES = 3;
const COPILOT_MAX_IMAGE_B64 = 1_400_000; // ~1MB decoded per image

/** Trust nothing from the client: only well-formed, size-capped base64 images pass. */
function sanitizeCopilotImages(images: unknown): LlmImage[] {
  if (!Array.isArray(images)) return [];
  const out: LlmImage[] = [];
  for (const img of images.slice(0, COPILOT_MAX_IMAGES)) {
    const mediaType = (img as { mediaType?: unknown })?.mediaType;
    const data = (img as { data?: unknown })?.data;
    if (typeof mediaType !== "string" || !COPILOT_IMAGE_TYPES.has(mediaType)) continue;
    if (typeof data !== "string" || data.length === 0 || data.length > COPILOT_MAX_IMAGE_B64) continue;
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(data)) continue;
    out.push({ mediaType: mediaType as LlmImage["mediaType"], data });
  }
  return out;
}

export async function sendCopilotPromptAction(
  prompt: string,
  history: HistoryTurnInput[] = [],
  sheetId?: string,
  images?: { mediaType: string; data: string }[]
) {
  const { workspaceId, userId, isSales } = await requireWorkspace();
  const safeImages = sanitizeCopilotImages(images);

  // Optional attached spreadsheet: the client only presents an id — the rows
  // live in a server-held session bound to THIS workspace + user (30-min TTL).
  const sheet =
    typeof sheetId === "string" && sheetId.length > 0
      ? SheetImportService.getSession(sheetId, workspaceId, userId)
      : null;

  // Trust nothing from the client: keep the last 10 turns, only valid roles,
  // plain-text bodies capped at 600 chars each (~turn budget for the prompt).
  const safeHistory: CopilotTurn[] = (Array.isArray(history) ? history : [])
    .slice(-10)
    .filter(
      (t): t is { role: "user" | "assistant"; text: string } =>
        typeof t?.role === "string" &&
        (t.role === "user" || t.role === "assistant") &&
        typeof t?.text === "string"
    )
    .map((t) => ({
      role: t.role,
      text: t.text.replace(/<[^>]*>/g, "").slice(0, 600),
    }))
    .filter((t) => t.text.trim().length > 0);

  const response = await AiAgentService.processCopilotCommand(workspaceId, prompt, safeHistory, sheet, safeImages, { hideMoney: isSales, ownerId: isSales ? userId : undefined });

  // Arm any write-proposals: replace client-visible payloads with unforgeable,
  // single-use tokens. The client never carries the proposal content.
  if (response.suggestedActions) {
    const armed: typeof response.suggestedActions = [];
    for (const action of response.suggestedActions) {
      if (!isWriteKind(action.actionType)) {
        armed.push(action);
        continue;
      }
      const proposal = normalizeWriteProposal(action.actionType, action.payload);
      if (!proposal) continue; // un-salvageable — drop the card, keep the answer
      if (isSales) {
        // No delete cards and no deal amounts for the sales team.
        if (proposal.kind.startsWith("DELETE_")) continue;
        delete proposal.dealValue;
        delete proposal.dealValueStr;
      }
      let cardExtras: Record<string, unknown> = {};
      if (action.actionType === "IMPORT_SHEET_LEADS") {
        // Rows, file name, and preview are bound from the VALIDATED session,
        // never from the client payload. No valid attachment → no card.
        if (!sheet) continue;
        proposal.sheetId = sheet.sheetId;
        proposal.sheetFileName = sheet.fileName;
        proposal.sheetRowCount = sheet.rowCount;
        proposal.sheetPreview = sheet.rows.slice(0, 5).map((r) => r.slice(0, 8));
        cardExtras = {
          fileName: sheet.fileName,
          rowCount: sheet.rowCount,
          headers: sheet.headers.slice(0, 8),
          preview: proposal.sheetPreview,
        };
      }
      const token = CopilotWriteService.issue(proposal, workspaceId, userId);
      armed.push({ ...action, payload: { writeToken: token, summary: summarizeProposal(proposal), ...cardExtras } });
    }
    response.suggestedActions = armed;
  }

  return response;
}

export async function discoverLeadsAction(query: string, industry?: string, location?: string) {
  await requireWorkspace();
  const trimmed = query.trim();
  if (trimmed.length < 3) {
    return { success: false as const, error: "Describe who to look for (min 3 characters)." };
  }
  // Network pipeline — bounded by per-fetch timeouts inside the service.
  return await LeadDiscoveryService.discover({
    query: trimmed.slice(0, 300),
    industry: industry?.slice(0, 120),
    location: location?.slice(0, 120),
    maxResults: 6,
  });
}

/**
 * Local-business discovery via OpenStreetMap (Nominatim + Overpass; free and
 * keyless — Hot/Warm/Cold tiered on the missing-web-presence signal).
 * Fails soft — geocoding/Overpass failures come back as honest notes.
 */
export async function discoverLocalLeadsAction(category: string, city: string, maxResults?: number) {
  await requireWorkspace();
  return await LocalLeadDiscoveryService.discover({
    category: category.trim().slice(0, 120),
    city: city.trim().slice(0, 120),
    maxResults: maxResults ?? 10,
  });
}

/**
 * Google Maps / Google Places discovery — richer data than OSM (ratings,
 * reviews, photos, price level). Requires GOOGLE_PLACES_API_KEY in env.
 * Falls back to OSM local discovery when the key is missing.
 */
export async function discoverGooglePlacesAction(category: string, city: string, maxResults?: number) {
  await requireWorkspace();
  const cat = category.trim().slice(0, 120);
  const cty = city.trim().slice(0, 120);
  const max = maxResults ?? 10;

  // Priority 1: Official Google Places API (best data, needs API key)
  if (GooglePlacesDiscoveryService.isAvailable()) {
    return await GooglePlacesDiscoveryService.discover({ category: cat, city: cty, maxResults: max });
  }

  // Priority 2: Free discovery via Nominatim + Photon (no key, no card)
  const scraped = await GoogleMapsScraperService.discover({ category: cat, city: cty, maxResults: max });
  if (scraped.success && scraped.leads.length > 0) {
    return scraped;
  }

  // Priority 3: OpenStreetMap fallback (free, keyless, but limited data for India)
  const osm = await LocalLeadDiscoveryService.discover({ category: cat, city: cty, maxResults: max });
  if (osm.success && osm.leads.length > 0) {
    return osm;
  }

  // All sources failed — return the most informative error
  return {
    success: false as const,
    query: `${cat} in ${cty}`,
    leads: [] as never[],
    llmUsed: false,
    notes: [
      ...(scraped.notes ?? []),
      ...(osm.notes ?? []),
      `No businesses found for "${cat}" in "${cty}" via free discovery. Try a broader category or larger city.`,
    ],
  };
}

export async function isGooglePlacesAvailable() {
  return GooglePlacesDiscoveryService.isAvailable();
}

/**
 * Enrich a lead — scrapes company website for emails, decision makers,
 * social links, tech stack signals. No paid API needed.
 */
export async function enrichLeadAction(params: {
  companyName: string;
  website: string | null;
  location?: string | null;
  industry?: string | null;
}): Promise<EnrichmentResult> {
  await requireWorkspace();
  return await LeadEnrichmentService.enrich({
    companyName: params.companyName.trim().slice(0, 200),
    website: params.website?.trim().slice(0, 500) ?? null,
    location: params.location?.trim().slice(0, 120),
    industry: params.industry?.trim().slice(0, 120),
  });
}

/**
 * Campaign analytics — aggregates sequence performance, intent signals,
 * conversion funnel, and generates actionable insights (step 19).
 */
export async function getCampaignAnalyticsAction(): Promise<CampaignOverview> {
  const { workspaceId } = await requireWorkspace();
  return await CampaignAnalyticsService.getOverview(workspaceId);
}

export type { EnrichmentResult, CampaignOverview };

// ---------------------------------------------------------------------------
// COPILOT WRITE-ACTIONS (explicit user confirmation required; fully audited)
// Proposal + result types, normalization, summarization, token lifecycle, and
// execution all live in services/ai/copilot-writes (shared with tests).
// ---------------------------------------------------------------------------
/** Re-exported for existing consumers; the implementation lives in services/ai/copilot-writes. */
export type { CopilotWriteProposal, CopilotWriteResult } from "@/services/ai/copilot-writes";

/**
 * Executes ONE copilot-proposed write after the user clicked Confirm in the
 * drawer. The proposal itself is server-held — the client presents only a
 * single-use token, so nothing can be tampered with or replayed. Entities are
 * resolved BY NAME against real workspace-scoped rows server-side; the client
 * can never pass raw IDs or a workspaceId. Every successful write lands in
 * audit_logs with via="copilot". The execution machinery (token store, entity
 * resolution, validation, audit) lives in services/ai/copilot-writes.
 */
export async function executeCopilotWriteAction(writeToken: string): Promise<CopilotWriteResult> {
  const { workspaceId, userId, isSales } = await requireWorkspace();
  const result = await CopilotWriteService.execute(writeToken, workspaceId, userId, { isSales });
  if (result.success && result.revalidatePaths) {
    for (const p of result.revalidatePaths) revalidatePath(p);
  }
  return { success: result.success, message: result.message, entityId: result.entityId };
}

/**
 * Imports one discovered lead into the CRM as a real company + contact + lead.
 * Thin wrapper over LeadImportService (shared with spreadsheet import):
 * dedupes by website domain, auto-scores, audits with via="ai_discovery",
 * and revalidates the affected routes on success.
 */
export async function importDiscoveredLeadAction(candidate: ImportLeadCandidate) {
  const { workspaceId, userId } = await requireWorkspace();
  const result = await LeadImportService.importCandidate(workspaceId, userId, candidate, { mode: "discovery" });
  if (!result.ok) {
    return { success: false as const, error: result.error ?? "Import failed" };
  }
  revalidatePath("/leads");
  revalidatePath("/companies");
  revalidatePath("/");
  return {
    success: true as const,
    leadId: result.leadId as string,
    companyId: result.companyId as string,
    score: result.score as number,
  };
}

/** Bulk import helper: imports every candidate, reporting per-item outcomes. */
export async function importDiscoveredLeadsAction(candidates: ImportLeadCandidate[]) {
  const results: { companyName: string; ok: boolean; error?: string; leadId?: string }[] = [];
  for (const candidate of candidates.slice(0, 20)) {
    try {
      const r = await importDiscoveredLeadAction(candidate);
      results.push(
        r.success
          ? { companyName: candidate.companyName, ok: true, leadId: r.leadId }
          : { companyName: candidate.companyName, ok: false, error: r.error }
      );
    } catch (error) {
      results.push({
        companyName: candidate.companyName,
        ok: false,
        error: error instanceof Error ? error.message : "Import failed",
      });
    }
  }
  return { results, imported: results.filter((r) => r.ok).length };
}

// ---------------------------------------------------------------------------
// SPREADSHEET ATTACHMENT (Google Sheet → server-held session)
// ---------------------------------------------------------------------------
export interface IngestSheetResult {
  success: boolean;
  error?: string;
  sheetId?: string;
  fileName?: string;
  headers?: string[];
  rowCount?: number;
  preview?: string[][];
  truncated?: boolean;
}

/**
 * Attaches a spreadsheet to the copilot session: either a .csv/.xlsx file
 * (exported from Google Sheets) or a docs.google.com share link fetched
 * server-side as CSV. Parsed rows are held SERVER-SIDE under an unforgeable
 * sheet id bound to workspace + user — the client receives only ids and
 * counts, never row data.
 */
export async function ingestSheetAction(formData: FormData): Promise<IngestSheetResult> {
  const { workspaceId, userId } = await requireWorkspace();

  const url = formData.get("url");
  const file = formData.get("file");

  let parsed: SheetParseResult;
  if (file && typeof file === "object" && "name" in file && "arrayBuffer" in file) {
    const f = file as File;
    if (typeof f.size === "number" && f.size > 2 * 1024 * 1024) {
      return { success: false, error: "That file is over 2 MB — export fewer rows, or paste the sheet's share link instead." };
    }
    if (!/\.(csv|xlsx|xls|tsv|txt)$/i.test(f.name)) {
      return { success: false, error: "Attach a .csv or .xlsx file (Google Sheets → File → Download → .csv/.xlsx)." };
    }
    const bytes = new Uint8Array(await f.arrayBuffer());
    parsed = SheetImportService.parseSheetBuffer(f.name, bytes);
  } else if (typeof url === "string" && url.trim().length > 0) {
    parsed = await SheetImportService.fetchSheetFromUrl(url.trim().slice(0, 2000));
  } else {
    return { success: false, error: "Attach a .csv/.xlsx file or paste a Google Sheets share link." };
  }

  if (!parsed.ok) return { success: false, error: parsed.error };

  const session = SheetImportService.storeSession(workspaceId, userId, parsed.sheet);
  return {
    success: true,
    sheetId: session.sheetId,
    fileName: session.fileName,
    headers: session.headers,
    rowCount: session.rowCount,
    truncated: session.truncated,
    preview: session.rows.slice(0, 5).map((r) => r.slice(0, 8)),
  };
}

export type { DiscoveredLead };
