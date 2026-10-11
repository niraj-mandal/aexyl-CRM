/**
 * Deterministic ICP + opportunity scoring for discovery candidates.
 * No AI — pure rule-based scoring with human-readable reasons and gaps.
 *
 * Dimensions (max 100):
 *   Business Fit:        0–25  (category match, named, has address)
 *   Location Fit:        0–15  (city match, has coordinates)
 *   Website Opportunity:  0–30  (NO_WEBSITE=30, BROKEN=27, POOR=24, BASIC=10, GOOD=0)
 *   Contactability:       0–15  (phone, email, social presence)
 *   Data Quality:         0–15  (opening hours, address completeness)
 */

import type { WebsiteStatus } from "./website-verifier";

export interface ScoringInput {
  businessName: string | null;
  category: string | null;
  targetCategory: string;
  address: string | null;
  city: string | null;
  targetCity: string;
  latitude: number | null;
  longitude: number | null;
  phone: string | null;
  email?: string | null;
  socials?: string[];
  website: string | null;
  websiteStatus: WebsiteStatus | null;
  openingHours: string | null;
  matchedTag: string | null;
}

export interface ScoringResult {
  fitScore: number;
  opportunityScore: number;
  totalScore: number;
  reasons: string[];
  gaps: string[];
}

const WEBSITE_OPPORTUNITY: Record<WebsiteStatus, number> = {
  NO_WEBSITE: 30,
  BROKEN_WEBSITE: 27,
  POOR_WEBSITE: 24,
  BASIC_WEBSITE: 10,
  GOOD_WEBSITE: 0,
  UNKNOWN: 15,
};

export class DiscoveryScorer {
  static score(input: ScoringInput): ScoringResult {
    const reasons: string[] = [];
    const gaps: string[] = [];

    let businessFit = 0;
    if (input.businessName && input.businessName.trim().length >= 2) {
      businessFit += 8;
      reasons.push("Named business");
    } else {
      gaps.push("No business name");
    }
    if (input.matchedTag) {
      businessFit += 10;
      reasons.push(`Category match: ${input.matchedTag}`);
    } else if (input.category?.toLowerCase().includes(input.targetCategory.toLowerCase())) {
      businessFit += 5;
      reasons.push("Partial category match");
    } else {
      gaps.push("No category tag match");
    }
    if (input.address && input.address.length > 5) {
      businessFit += 7;
      reasons.push("Has address");
    } else {
      gaps.push("No address listed");
    }

    let locationFit = 0;
    const cityMatch = input.city
      && input.targetCity
      && input.city.toLowerCase().includes(input.targetCity.toLowerCase().split(",")[0].trim());
    if (cityMatch) {
      locationFit += 10;
      reasons.push(`In target city: ${input.targetCity}`);
    } else {
      gaps.push("City not confirmed");
    }
    if (input.latitude != null && input.longitude != null) {
      locationFit += 5;
      reasons.push("GPS coordinates available");
    }

    const ws = input.websiteStatus ?? (input.website ? "BASIC_WEBSITE" : "NO_WEBSITE");
    const websiteOpp = WEBSITE_OPPORTUNITY[ws] ?? 15;
    if (websiteOpp >= 24) {
      reasons.push(`High opportunity: ${ws.replace(/_/g, " ").toLowerCase()}`);
    } else if (websiteOpp >= 10) {
      reasons.push("Moderate web presence");
    } else {
      gaps.push("Good website — lower opportunity");
    }

    let contactability = 0;
    if (input.phone) {
      contactability += 10;
      reasons.push("Phone number available");
    } else {
      gaps.push("No phone number");
    }
    if (input.email) {
      contactability += 5;
      reasons.push("Email listed");
    }
    if (input.socials && input.socials.length > 0) {
      contactability += 5;
      reasons.push("Social profile listed");
    }
    if (input.website) {
      contactability += 5;
    }

    let dataQuality = 0;
    if (input.openingHours) {
      dataQuality += 8;
      reasons.push("Opening hours listed");
    } else {
      gaps.push("No opening hours");
    }
    if (input.address && input.address.includes(",")) {
      dataQuality += 4;
    }
    if (input.latitude != null) {
      dataQuality += 3;
    }

    const fitScore = Math.min(25, businessFit)
      + Math.min(15, locationFit)
      + Math.min(15, contactability)
      + Math.min(15, dataQuality);

    const opportunityScore = Math.min(30, websiteOpp);
    const totalScore = Math.min(100, fitScore + opportunityScore);

    return { fitScore, opportunityScore, totalScore, reasons, gaps };
  }

  static qualifies(result: ScoringResult, minScore = 30): boolean {
    return result.totalScore >= minScore;
  }
}
