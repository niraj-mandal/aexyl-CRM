/**
 * Lead-import core — turns one candidate record (from web discovery, local
 * discovery, or a spreadsheet row) into a real company + contact + lead with
 * dedupe, deterministic scoring, and an audit row.
 *
 * Extracted from app/actions/ai.actions.ts so services/ai/copilot-writes.ts
 * (imported directly by tests, outside Next) can reuse it without pulling in
 * a "use server" module. Discovery mode preserves the exact historical
 * behavior; sheet mode reuses existing companies and dedupes on the contact's
 * email instead of skipping on company match (multiple contacts per company).
 */
import { CrmService } from "@/services/crm.service";
import { ActivityService } from "@/services/activity.service";
import { LeadScoringService } from "@/services/sales/lead-scoring.service";

export interface ImportLeadCandidate {
  companyName: string;
  website: string | null;
  industry: string | null;
  location: string | null;
  size: string | null;
  description: string | null;
  emails: string[];
  phones: string[];
  linkedin: string | null;
  fitScore: number;
  sourceQuery: string;
  sourceUrl: string | null;
  /** Local-discovery extras (OpenStreetMap). Optional so the web-search pipeline is unchanged. */
  placeId?: string;
  rating?: number | null;
  reviewCount?: number | null;
  priority?: string;
  /** Why this tier — cited factual signals (missing website, review count). */
  priorityReason?: string | null;
  /** LLM-generated outreach hook — labeled model-generated, stored in notes, never a factual field. */
  hook?: string | null;
  /** Spreadsheet extras (sheet import only). */
  contactName?: string | null;
  jobTitle?: string | null;
  /** 1-based data-row number in the source sheet, for audits. */
  sourceRow?: number;
}

export interface ImportCandidateOptions {
  /** discovery = original AI-discovery behavior; sheet = spreadsheet row semantics. */
  mode?: "discovery" | "sheet";
  /** Provenance label for sheet mode (file name). */
  sheetFileName?: string;
}

export interface ImportCandidateResult {
  ok: boolean;
  /** True when the row already exists in the CRM (dedupe) — not a failure. */
  skipped?: boolean;
  leadId?: string;
  companyId?: string;
  score?: number;
  error?: string;
}

export class LeadImportService {
  /**
   * Imports ONE candidate as company + contact + lead. Never throws for
   * expected outcomes (dedupe, validation) — returns a structured result so
   * batch callers can tally per-row outcomes.
   */
  static async importCandidate(
    workspaceId: string,
    userId: string,
    candidate: ImportLeadCandidate,
    opts: ImportCandidateOptions = {}
  ): Promise<ImportCandidateResult> {
    const mode = opts.mode ?? "discovery";
    const sheetFile = opts.sheetFileName ?? null;

    if (typeof candidate?.companyName !== "string" || candidate.companyName.trim().length === 0) {
      return { ok: false, error: "Company name is required." };
    }

    // --- dedupe --------------------------------------------------------------
    if (mode === "sheet") {
      // Identity is the person: an email already in the workspace means this
      // row was imported before. Companies are NOT skipped — sheets routinely
      // hold several contacts at one account, so a match reuses the row.
      const email = candidate.emails[0];
      if (email) {
        const existing = await CrmService.findContactByEmail(workspaceId, email);
        if (existing) {
          return { ok: false, skipped: true, error: `Contact ${email} already in CRM.` };
        }
      }
    } else {
      if (candidate.website) {
        const existing = await CrmService.findCompanyByWebsite(workspaceId, candidate.website);
        if (existing) {
          return { ok: false, skipped: true, error: `Already in CRM as "${existing.name}".` };
        }
      } else {
        // Without a place id, only an exact name + address match is the same gym (chains share names).
        const existing = await CrmService.findCompanyByName(workspaceId, candidate.companyName);
        if (existing && (candidate.placeId || (existing.location ?? "") === (candidate.location ?? ""))) {
          return { ok: false, skipped: true, error: `Already in CRM as "${existing.name}".` };
        }
      }
    }

    // Real, per-place details go in company notes verbatim (no inference): the
    // Google rating/review count, Maps link, placeId, and the labeled LLM hook.
    const localNotes =
      [
        candidate.description,
        typeof candidate.rating === "number" ? `Google rating: ${candidate.rating}★` : null,
        typeof candidate.reviewCount === "number" ? `Google reviews: ${candidate.reviewCount}` : null,
        candidate.sourceUrl ? `Maps: ${candidate.sourceUrl}` : null,
        candidate.placeId ? `place_id: ${candidate.placeId}` : null,
        candidate.hook ? `Suggested hook (AI-generated, verify before use): ${candidate.hook}` : null,
      ]
        .filter(Boolean)
        .join("\n") || null;

    const sourceLabel =
      mode === "sheet"
        ? `Sheet import: ${(sheetFile ?? "sheet").slice(0, 100)}`
        : `AI Discovery: ${candidate.sourceQuery.slice(0, 100)}`;

    // --- company -------------------------------------------------------------
    let company;
    if (mode === "sheet") {
      company =
        (candidate.website ? await CrmService.findCompanyByWebsite(workspaceId, candidate.website) : null) ??
        (await CrmService.findCompanyByName(workspaceId, candidate.companyName.trim()));
    }
    if (!company) {
      company = await CrmService.createCompany(workspaceId, {
        name: candidate.companyName.trim().slice(0, 160),
        website: candidate.website,
        industry: candidate.industry,
        location: candidate.location,
        size: candidate.size,
        source: sourceLabel,
        notes: localNotes,
        ownerId: userId,
      });
    }

    // --- primary contact -----------------------------------------------------
    const primaryEmail = candidate.emails[0] ?? null;
    const primaryPhone = candidate.phones[0] ?? null;
    const wantsContact =
      mode === "sheet"
        ? Boolean(primaryEmail || primaryPhone || candidate.contactName)
        : Boolean(primaryEmail || primaryPhone);
    let contactId: string | null = null;
    if (wantsContact) {
      // Sheet rows carry real person names; discovery candidates keep the
      // historical "Team <company>" placeholder.
      let firstName = "Team";
      let lastName: string | null = candidate.companyName.trim().slice(0, 60);
      if (mode === "sheet" && candidate.contactName) {
        const parts = candidate.contactName.trim().split(/\s+/);
        firstName = parts[0].slice(0, 60);
        lastName = parts.slice(1).join(" ").slice(0, 60) || null;
      }
      const contact = await CrmService.createContact(workspaceId, {
        companyId: company.id,
        firstName,
        lastName,
        email: primaryEmail,
        phone: primaryPhone,
        jobTitle: candidate.jobTitle ?? null,
        notes: candidate.linkedin ? `LinkedIn: ${candidate.linkedin}` : null,
      });
      contactId = contact.id;
    }

    // --- deterministic score -------------------------------------------------
    const score = LeadScoringService.calculateScore(
      { temperature: "WARM", stage: "NEW", status: "NEW" },
      {
        email: primaryEmail ?? undefined,
        phone: primaryPhone ?? undefined,
        linkedinUrl: candidate.linkedin ?? undefined,
        jobTitle: candidate.jobTitle ?? undefined,
      }
    );

    // --- lead ----------------------------------------------------------------
    const lead = await CrmService.createLead(workspaceId, {
      companyId: company.id,
      contactId,
      ownerId: userId,
      source: sourceLabel,
      status: "NEW",
      stage: "NEW",
      score,
      // Local leads carry their discovery tier through: a Hot local lead (no
      // website, no phone) lands as a HOT lead, not merely WARM. Sheet rows
      // carry priority="Warm" from the mapper (operator-vetted, never HOT).
      temperature:
        candidate.priority === "Hot" || candidate.fitScore >= 70
          ? "HOT"
          : candidate.priority === "Warm"
            ? "WARM"
            : "COLD",
      notes:
        [
          candidate.description
            ? candidate.description.slice(0, 500)
            : mode === "sheet"
              ? `Imported from sheet ${sheetFile ?? ""}.`
              : "Discovered by Aexyl Lead Discovery.",
          `Fit: ${candidate.fitScore}/100.`,
          // Discovery-tier metadata is only a factual signal for discovery
          // rows — never inject it as if it came from the spreadsheet.
          mode === "discovery" && candidate.priority ? `Local priority: ${candidate.priority}.` : null,
          mode === "discovery" && candidate.priorityReason ? `Why: ${candidate.priorityReason}` : null,
          mode === "discovery" && candidate.hook
            ? `Suggested hook (AI-generated, verify before use): ${candidate.hook}`
            : null,
        ]
          .filter(Boolean)
          .join("\n"),
    });

    await ActivityService.logAudit(
      workspaceId,
      userId,
      "CREATE",
      "LEAD",
      lead.id,
      mode === "sheet"
        ? {
            via: "copilot",
            sheetFile,
            sourceRow: candidate.sourceRow ?? null,
            company: company.name,
            website: candidate.website,
            email: primaryEmail,
          }
        : {
            via: "ai_discovery",
            company: company.name,
            website: candidate.website,
            sourceQuery: candidate.sourceQuery,
            fitScore: candidate.fitScore,
            sourceUrl: candidate.sourceUrl,
            placeId: candidate.placeId ?? null,
            priority: candidate.priority ?? null,
          }
    );

    return { ok: true, leadId: lead.id, companyId: company.id, score };
  }
}
