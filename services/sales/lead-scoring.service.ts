import { type leads, type contacts } from "@/db/schema";

export class LeadScoringService {
  /**
   * Calculates a deterministic lead score (0-100) based on Phase 2 requirements.
   * Future phases will augment this with AI models.
   */
  static calculateScore(
    lead: Partial<typeof leads.$inferSelect>, 
    contact?: Partial<typeof contacts.$inferSelect>
  ): number {
    let score = 0;

    // 1. Temperature baseline
    if (lead.temperature === 'HOT') score += 40;
    else if (lead.temperature === 'WARM') score += 20;
    else score += 5; // COLD

    // 2. Profile completeness (Contact)
    if (contact) {
      if (contact.email) score += 10;
      if (contact.phone) score += 10;
      if (contact.linkedinUrl) score += 5;
      if (contact.jobTitle && (contact.jobTitle.toLowerCase().includes('ceo') || contact.jobTitle.toLowerCase().includes('founder') || contact.jobTitle.toLowerCase().includes('director'))) {
        score += 15; // ICP fit bonus
      }
    }

    // 3. Stage momentum
    if (lead.stage === 'QUALIFIED') score += 15;
    if (lead.status === 'CONTACTED') score += 5;

    // Clamp score to 100
    return Math.min(Math.max(score, 0), 100);
  }
}
