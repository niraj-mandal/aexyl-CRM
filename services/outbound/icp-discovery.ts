import { CrmService } from "@/services/crm.service";

export type IcpMatch = {
  leadId: string;
  score: number;
  tier: "PRIORITY" | "GOOD_FIT" | "POSSIBLE_FIT" | "LOW_FIT";
  reasons: string[];
  gaps: string[];
};

function tokens(input?: string | null) {
  return (input || "").toLowerCase().split(/[^a-z0-9]+/).filter((x) => x.length >= 3);
}

export function scoreLeadAgainstIcp(lead: any, targetProfile?: string | null): IcpMatch {
  const target = new Set(tokens(targetProfile));
  const company = lead.company;
  const contact = lead.contact;
  const fields = [
    ["industry", company?.industry],
    ["location", company?.location],
    ["size", company?.size],
    ["job title", contact?.jobTitle],
    ["company name", company?.name],
  ] as const;
  const reasons: string[] = [];
  const gaps: string[] = [];
  let score = 0;
  let matched = 0;

  if (!target.size) {
    return { leadId: lead.id, score: 50, tier: "POSSIBLE_FIT", reasons: ["Campaign has no structured ICP keywords yet."], gaps: ["Define the campaign target profile."] };
  }

  for (const [label, value] of fields) {
    const fieldTokens = new Set(tokens(value));
    const hits = [...target].filter((t) => fieldTokens.has(t));
    if (hits.length) {
      matched += hits.length;
      score += Math.min(20, hits.length * 8);
      reasons.push(label + ": matched " + hits.slice(0, 3).join(", "));
    }
  }

  if (contact?.email) { score += 10; reasons.push("Verified contact email is present."); } else gaps.push("No contact email.");
  if (contact?.jobTitle) { score += 10; } else gaps.push("Contact role is missing.");
  if (company?.industry) { score += 5; } else gaps.push("Company industry is missing.");
  if (company?.website) { score += 5; } else gaps.push("Company website is missing.");

  score = Math.min(100, score);
  const tier = score >= 75 ? "PRIORITY" : score >= 55 ? "GOOD_FIT" : score >= 35 ? "POSSIBLE_FIT" : "LOW_FIT";
  if (!matched) gaps.unshift("No direct ICP keyword match found in CRM fields.");
  return { leadId: lead.id, score, tier, reasons, gaps };
}

export async function discoverIcpMatches(workspaceId: string, campaignId: string) {
  const campaign = await CrmService.getOutboundCampaignById(workspaceId, campaignId);
  if (!campaign) throw new Error("Campaign not found.");
  const leads = await CrmService.getLeads(workspaceId, 500, 0);
  const enrolled = new Set((campaign.enrollments || []).map((e: any) => e.leadId));
  return leads
    .filter((lead: any) => !enrolled.has(lead.id) && lead.status !== "LOST")
    .map((lead: any) => ({ lead, ...scoreLeadAgainstIcp(lead, campaign.targetProfile) }))
    .sort((a, b) => b.score - a.score);
}
