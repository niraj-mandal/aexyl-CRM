/**
 * Google Maps search for a business — opens its Google Business Profile when one exists.
 * The place narrows the match so a same-named business in another city isn't picked.
 */
export function googleMapsUrl(name: string, place?: string | null): string {
  const query = [name, place].filter(Boolean).join(", ");
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

/** "AI Discovery: gym in Guwahati, Assam, India" → "Guwahati, Assam, India" */
export function placeFromLeadSource(source: string | null | undefined): string | null {
  const match = source?.match(/\bin\s+(.+)$/i);
  return match ? match[1].trim() : null;
}
