import { scoreLeadAgainstIcp } from "@/services/outbound/icp-discovery";

export type ExternalProspect = {
  companyName: string;
  website?: string;
  industry?: string;
  location?: string;
  contactFirstName?: string;
  contactLastName?: string;
  contactEmail?: string;
  contactJobTitle?: string;
  linkedinUrl?: string;
  source: string;
};

export function scoreExternalProspect(prospect: ExternalProspect, targetProfile?: string | null) {
  const pseudoLead = {
    id: "external",
    company: { name: prospect.companyName, website: prospect.website, industry: prospect.industry, location: prospect.location },
    contact: { firstName: prospect.contactFirstName, lastName: prospect.contactLastName, email: prospect.contactEmail, jobTitle: prospect.contactJobTitle },
  };
  return scoreLeadAgainstIcp(pseudoLead, targetProfile);
}

export function normalizeExternalProspect(input: Partial<ExternalProspect>, source: string): ExternalProspect | null {
  const companyName = input.companyName?.trim();
  if (!companyName) return null;
  return {
    companyName,
    website: input.website?.trim() || undefined,
    industry: input.industry?.trim() || undefined,
    location: input.location?.trim() || undefined,
    contactFirstName: input.contactFirstName?.trim() || undefined,
    contactLastName: input.contactLastName?.trim() || undefined,
    contactEmail: input.contactEmail?.trim().toLowerCase() || undefined,
    contactJobTitle: input.contactJobTitle?.trim() || undefined,
    linkedinUrl: input.linkedinUrl?.trim() || undefined,
    source,
  };
}
