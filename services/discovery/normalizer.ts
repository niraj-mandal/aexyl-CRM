/**
 * Normalization + deduplication helpers for discovery candidates.
 * Handles business name, phone (Indian +91), URL/domain, and
 * cross-batch + cross-CRM dedup.
 */

import { db } from "@/db";
import { discoveryCandidates, companies } from "@/db/schema";
import { and, eq, isNull, ne, or } from "drizzle-orm";
import { NO_CONTACT_REASON, type RawProspect } from "./provider";

export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[''`]/g, "'")
    .replace(/[^\p{L}\p{N}\s'&-]/gu, "")
    .replace(/\b(the|pvt|ltd|llp|inc|corp|co|mr|mrs|ms|dr|shri|smt)\b\.?/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizePhone(phone: string | null): string | null {
  if (!phone) return null;
  let digits = phone.replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) {
    digits = "+" + digits.slice(1).replace(/\D/g, "");
  }
  if (digits.startsWith("0") && digits.length === 10) {
    digits = "+91" + digits.slice(1);
  } else if (/^\d{10}$/.test(digits)) {
    digits = "+91" + digits;
  } else if (digits.startsWith("91") && digits.length === 12) {
    digits = "+" + digits;
  }
  if (!digits.startsWith("+")) digits = "+" + digits;
  return digits.length >= 8 ? digits : null;
}

export function normalizeDomain(url: string | null): string | null {
  if (!url) return null;
  try {
    const full = url.startsWith("http") ? url : `https://${url}`;
    const u = new URL(full);
    return u.hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

export function normalizeUrl(url: string | null): string | null {
  if (!url) return null;
  let cleaned = url.trim();
  if (!cleaned.startsWith("http")) cleaned = `https://${cleaned}`;
  try {
    const u = new URL(cleaned);
    return u.origin + u.pathname.replace(/\/+$/, "");
  } catch {
    return null;
  }
}

export interface NormalizedCandidate extends RawProspect {
  normalizedName: string;
  normalizedPhone: string | null;
  normalizedDomain: string | null;
}

export function normalizeProspects(prospects: RawProspect[]): NormalizedCandidate[] {
  return prospects
    .filter((p) => p.businessName && p.businessName.trim().length >= 2)
    .map((p) => ({
      ...p,
      normalizedName: normalizeName(p.businessName!),
      normalizedPhone: normalizePhone(p.phone),
      normalizedDomain: normalizeDomain(p.website),
    }));
}

export function deduplicateWithinBatch(candidates: NormalizedCandidate[]): NormalizedCandidate[] {
  const seen = new Map<string, NormalizedCandidate>();
  for (const c of candidates) {
    const nameKey = c.normalizedName;
    if (c.normalizedDomain && [...seen.values()].some((s) => s.normalizedDomain === c.normalizedDomain)) {
      continue;
    }
    if (seen.has(nameKey)) continue;
    seen.set(nameKey, c);
  }
  return [...seen.values()];
}

export async function deduplicateAgainstExisting(
  workspaceId: string,
  candidates: NormalizedCandidate[],
): Promise<{ fresh: NormalizedCandidate[]; duplicates: NormalizedCandidate[] }> {
  if (candidates.length === 0) return { fresh: [], duplicates: [] };

  const fresh: NormalizedCandidate[] = [];
  const duplicates: NormalizedCandidate[] = [];

  // Candidates skipped only for missing contact info stay re-discoverable,
  // so a richer source (e.g. Google Places with a phone) can bring them back.
  const existingCandidateNames = await db
    .select({ normalizedName: discoveryCandidates.normalizedName })
    .from(discoveryCandidates)
    .where(and(
      eq(discoveryCandidates.workspaceId, workspaceId),
      or(
        isNull(discoveryCandidates.rejectedReason),
        ne(discoveryCandidates.rejectedReason, NO_CONTACT_REASON),
      ),
    ));
  const existingNameSet = new Set(existingCandidateNames.map((r) => r.normalizedName));

  const existingCompanies = await db
    .select({ name: companies.name, website: companies.website })
    .from(companies)
    .where(eq(companies.workspaceId, workspaceId));
  const companyNameSet = new Set(existingCompanies.map((c) => normalizeName(c.name)));
  const companyDomainSet = new Set(
    existingCompanies.map((c) => normalizeDomain(c.website)).filter(Boolean),
  );

  for (const c of candidates) {
    const isDupeCandidate = existingNameSet.has(c.normalizedName);
    const isDupeCompany = companyNameSet.has(c.normalizedName);
    const isDupeDomain = c.normalizedDomain && companyDomainSet.has(c.normalizedDomain);

    if (isDupeCandidate || isDupeCompany || isDupeDomain) {
      duplicates.push(c);
    } else {
      fresh.push(c);
    }
  }

  return { fresh, duplicates };
}
