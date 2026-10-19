/**
 * Google Places (official API) discovery provider. Unlike OSM, Places
 * returns phone numbers for most local businesses, so it is preferred
 * whenever GOOGLE_PLACES_API_KEY is configured. Server-side only.
 */

import type { BusinessDiscoveryProvider, DiscoveryQuery, ProviderResult, RawProspect } from "./provider";

const API_KEY_ENV = "GOOGLE_PLACES_API_KEY";
const TEXT_SEARCH_URL = "https://places.googleapis.com/v1/places:searchText";
const FETCH_TIMEOUT = 15_000;
const MAX_PER_QUERY = 20;

const FIELD_MASK = [
  "places.id", "places.displayName", "places.formattedAddress",
  "places.nationalPhoneNumber", "places.internationalPhoneNumber",
  "places.websiteUri", "places.googleMapsUri", "places.location",
  "places.regularOpeningHours", "places.businessStatus", "places.primaryType",
].join(",");

const QUERY_VARIANTS: Record<string, string[]> = {
  gym: ["gym", "fitness centre", "crossfit"],
  fitness: ["gym", "fitness centre"],
};

interface PlaceResult {
  id?: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  nationalPhoneNumber?: string;
  internationalPhoneNumber?: string;
  websiteUri?: string;
  googleMapsUri?: string;
  location?: { latitude?: number; longitude?: number };
  regularOpeningHours?: { weekdayDescriptions?: string[] };
  businessStatus?: string;
  primaryType?: string;
}

export class GooglePlacesDiscoveryProvider implements BusinessDiscoveryProvider {
  static isAvailable(): boolean {
    return Boolean(process.env[API_KEY_ENV]?.trim());
  }

  async search(query: DiscoveryQuery): Promise<ProviderResult> {
    const apiKey = process.env[API_KEY_ENV]?.trim();
    const notes: string[] = [];
    if (!apiKey) {
      return { success: false, prospects: [], notes: ["GOOGLE_PLACES_API_KEY not configured."], queriesRun: 0 };
    }

    const cityName = query.city.split(",")[0].trim();
    const variants = query.queries
      ?? QUERY_VARIANTS[query.category.toLowerCase().trim()]
      ?? [query.category];

    const seen = new Set<string>();
    const prospects: RawProspect[] = [];
    let queriesRun = 0;

    for (const variant of variants) {
      const textQuery = `${variant} in ${query.city}`;
      const places = await this.textSearch(textQuery, apiKey, notes);
      queriesRun++;
      for (const place of places) {
        const p = this.toProspect(place, query.category, cityName, textQuery);
        if (!p || seen.has(p.externalId)) continue;
        seen.add(p.externalId);
        prospects.push(p);
      }
    }

    notes.push(`Google Places: ${queriesRun} queries → ${prospects.length} unique businesses.`);
    return { success: prospects.length > 0, prospects, notes, queriesRun };
  }

  private async textSearch(textQuery: string, apiKey: string, notes: string[]): Promise<PlaceResult[]> {
    try {
      const res = await fetch(TEXT_SEARCH_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": apiKey,
          "X-Goog-FieldMask": FIELD_MASK,
        },
        body: JSON.stringify({ textQuery, maxResultCount: MAX_PER_QUERY, languageCode: "en", regionCode: "IN" }),
        signal: AbortSignal.timeout(FETCH_TIMEOUT),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        notes.push(`Google Places HTTP ${res.status} for "${textQuery}": ${body.slice(0, 160)}`);
        return [];
      }
      const json = (await res.json()) as { places?: PlaceResult[] };
      return json.places ?? [];
    } catch (error) {
      notes.push(`Google Places "${textQuery}" failed: ${error instanceof Error ? error.message : "network error"}`);
      return [];
    }
  }

  private toProspect(place: PlaceResult, category: string, cityName: string, sourceQuery: string): RawProspect | null {
    const name = place.displayName?.text?.trim();
    if (!name || !place.id) return null;
    if (place.businessStatus && place.businessStatus !== "OPERATIONAL") return null;

    const address = place.formattedAddress?.trim() || null;
    const inCity = address?.toLowerCase().includes(cityName.toLowerCase()) ?? false;

    return {
      externalId: place.id,
      source: "google_places",
      businessName: name,
      category,
      address,
      city: inCity ? cityName : null,
      state: null,
      country: "IN",
      latitude: place.location?.latitude ?? null,
      longitude: place.location?.longitude ?? null,
      phone: place.internationalPhoneNumber?.trim() || place.nationalPhoneNumber?.trim() || null,
      email: null,
      socials: [],
      website: place.websiteUri?.trim() || null,
      openingHours: place.regularOpeningHours?.weekdayDescriptions?.join("; ") ?? null,
      sourceUrl: place.googleMapsUri ?? null,
      sourceQuery,
      matchedTag: place.primaryType ? `google:${place.primaryType}` : null,
      rawTags: {},
    };
  }
}
