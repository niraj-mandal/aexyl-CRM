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

export type DiscoveryQuery = { query: string; limit?: number };
export type DiscoveryProvider = { search(query: DiscoveryQuery): Promise<Partial<ExternalProspect>[]> };

/** Adapter for an approved external research service. The provider returns { prospects: [...] }. */
export class HttpDiscoveryProvider implements DiscoveryProvider {
  constructor(private readonly url: string, private readonly token?: string) {}
  async search(query: DiscoveryQuery) {
    const response = await fetch(this.url, {
      method: "POST",
      headers: { "content-type": "application/json", ...(this.token ? { authorization: `Bearer ${this.token}` } : {}) },
      body: JSON.stringify(query),
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`Discovery provider failed: ${response.status}`);
    const data = await response.json() as { prospects?: Partial<ExternalProspect>[] };
    return data.prospects || [];
  }
}
export function getDiscoveryProvider() {
  const url = process.env.AEXYL_DISCOVERY_PROVIDER_URL;
  return url ? new HttpDiscoveryProvider(url, process.env.AEXYL_DISCOVERY_PROVIDER_TOKEN) : null;
}
export async function discoverExternalProspects(query: DiscoveryQuery) {
  const provider = getDiscoveryProvider();
  if (!provider) throw new Error("External discovery is not configured. Set AEXYL_DISCOVERY_PROVIDER_URL.");
  return provider.search({ ...query, limit: Math.min(query.limit || 50, 100) });
}
