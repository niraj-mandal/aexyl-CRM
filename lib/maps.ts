/**
 * Google Maps search for a business — opens its Google Business Profile when one exists.
 * The place narrows the match so a same-named business in another city isn't picked.
 */
export function googleMapsUrl(name: string, place?: string | null): string {
  const query = [name, place].filter(Boolean).join(", ");
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

/**
 * The city a lead belongs to, for grouping the Leads list. Prefers the city discovery searched,
 * then the search in the lead's source, then the district of an "Area, District, State" address.
 */
export function leadCity(l: { candidateCity?: string | null; source?: string | null; location?: string | null }): string {
  const parts = l.location?.split(",").map((p) => p.trim()).filter(Boolean) ?? [];
  const raw =
    l.candidateCity?.split(",")[0].trim() ||
    placeFromLeadSource(l.source)?.split(",")[0].trim() ||
    (parts.length >= 3 ? parts[parts.length - 2] : "");
  if (!raw) return "Unknown";
  // "GUWAHATI" → "Guwahati"
  return raw === raw.toUpperCase() ? raw.charAt(0) + raw.slice(1).toLowerCase() : raw;
}

/** "AI Discovery: gym in Guwahati, Assam, India" → "Guwahati, Assam, India" */
export function placeFromLeadSource(source: string | null | undefined): string | null {
  const match = source?.match(/\bin\s+(.+)$/i);
  return match ? match[1].trim() : null;
}
