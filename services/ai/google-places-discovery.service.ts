import { LlmService } from "./llm.service";

/**
 * Google Places lead discovery — richer local business data than OSM.
 *
 * Pipeline: Text Search (category + city) → Place Details (per result) →
 * tier by rating/reviews/website → optional LLM hook → ranked leads.
 *
 * Requires GOOGLE_PLACES_API_KEY in env. The first $200/month is free
 * from Google (~5,000 Text Search requests).
 */

const API_KEY_ENV = "GOOGLE_PLACES_API_KEY";
const PLACES_TEXT_SEARCH_URL = "https://places.googleapis.com/v1/places:searchText";
const FETCH_TIMEOUT = 15_000;
const HOOK_MAX_LEADS = 20;

export type GooglePlacesPriority = "Hot" | "Warm" | "Cold";

export interface GooglePlacesLead {
  companyName: string;
  website: string | null;
  industry: string | null;
  location: string | null;
  phone: string | null;
  rating: number | null;
  reviewCount: number | null;
  openingHours: string | null;
  lat: number | null;
  lng: number | null;
  placeId: string;
  googleMapsUrl: string | null;
  photos: string[];
  priceLevel: string | null;
  priority: GooglePlacesPriority;
  priorityReason: string;
  suggestedHook: string | null;
  sourceQuery: string;
  sourceUrl: string | null;
  fitScore: number;
  businessStatus: string | null;
  types: string[];
}

export interface GooglePlacesDiscoveryResult {
  success: boolean;
  query: string;
  leads: GooglePlacesLead[];
  llmUsed: boolean;
  notes: string[];
}

interface PlaceResult {
  id?: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  nationalPhoneNumber?: string;
  internationalPhoneNumber?: string;
  websiteUri?: string;
  googleMapsUri?: string;
  rating?: number;
  userRatingCount?: number;
  currentOpeningHours?: { weekdayDescriptions?: string[] };
  regularOpeningHours?: { weekdayDescriptions?: string[] };
  location?: { latitude?: number; longitude?: number };
  photos?: { name?: string }[];
  priceLevel?: string;
  businessStatus?: string;
  types?: string[];
  primaryType?: string;
}

export class GooglePlacesDiscoveryService {
  static isAvailable(): boolean {
    return Boolean(process.env[API_KEY_ENV]?.trim());
  }

  static async discover(request: {
    category: string;
    city: string;
    maxResults?: number;
  }): Promise<GooglePlacesDiscoveryResult> {
    const category = request.category.trim();
    const city = request.city.trim();
    const query = `${category} in ${city}`;
    const notes: string[] = [];
    const maxResults = Math.min(Math.max(request.maxResults ?? 10, 1), 20);

    const apiKey = process.env[API_KEY_ENV]?.trim();
    if (!apiKey) {
      return {
        success: false, query, leads: [], llmUsed: false,
        notes: ["Google Places API key not configured. Add GOOGLE_PLACES_API_KEY to .env.local."],
      };
    }

    if (category.length < 2 || city.length < 2) {
      return {
        success: false, query, leads: [], llmUsed: false,
        notes: ["Both a category (e.g. \"gym\") and a city (e.g. \"Austin, TX\") are required."],
      };
    }

    try {
      const places = await GooglePlacesDiscoveryService.textSearch(query, maxResults, apiKey, notes);
      if (places.length === 0) {
        notes.push("Google Places returned no results for this query.");
        return { success: false, query, leads: [], llmUsed: false, notes };
      }
      notes.push(`Google Maps found ${places.length} businesses.`);

      const seen = new Set<string>();
      let leads: GooglePlacesLead[] = [];

      for (const place of places) {
        const lead = GooglePlacesDiscoveryService.toPlacesLead(place, { category, city });
        if (!lead || seen.has(lead.placeId)) continue;
        seen.add(lead.placeId);
        leads.push(lead);
        if (leads.length >= maxResults) break;
      }

      if (leads.length === 0) {
        notes.push("No valid businesses in the results.");
        return { success: false, query, leads: [], llmUsed: false, notes };
      }

      const hot = leads.filter((l) => l.priority === "Hot").length;
      const warm = leads.filter((l) => l.priority === "Warm").length;
      notes.push(`${hot} Hot, ${warm} Warm, ${leads.length - hot - warm} Cold leads.`);

      let llmUsed = false;
      if (LlmService.getStatus().available) {
        const hooks = await GooglePlacesDiscoveryService.suggestHooks(leads.slice(0, HOOK_MAX_LEADS), category);
        if (hooks) {
          llmUsed = true;
          notes.push("AI outreach angles drafted (suggestions only — verify before use).");
          for (const [placeId, hook] of hooks) {
            const idx = leads.findIndex((l) => l.placeId === placeId);
            if (idx >= 0) leads[idx] = { ...leads[idx], suggestedHook: hook };
          }
        }
      }

      leads = leads
        .sort((a, b) => {
          const tierRank: Record<GooglePlacesPriority, number> = { Hot: 0, Warm: 1, Cold: 2 };
          return tierRank[a.priority] - tierRank[b.priority] || b.fitScore - a.fitScore;
        })
        .slice(0, maxResults);

      return { success: true, query, leads, llmUsed, notes };
    } catch (error) {
      notes.push(`Google Places API error: ${error instanceof Error ? error.message : "unknown error"}`);
      return { success: false, query, leads: [], llmUsed: false, notes };
    }
  }

  private static async textSearch(
    query: string,
    maxResults: number,
    apiKey: string,
    notes: string[]
  ): Promise<PlaceResult[]> {
    const fieldMask = [
      "places.id", "places.displayName", "places.formattedAddress",
      "places.nationalPhoneNumber", "places.internationalPhoneNumber",
      "places.websiteUri", "places.googleMapsUri", "places.rating",
      "places.userRatingCount", "places.currentOpeningHours",
      "places.regularOpeningHours", "places.location", "places.photos",
      "places.priceLevel", "places.businessStatus", "places.types",
      "places.primaryType",
    ].join(",");

    try {
      const res = await fetch(PLACES_TEXT_SEARCH_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": apiKey,
          "X-Goog-FieldMask": fieldMask,
        },
        body: JSON.stringify({
          textQuery: query,
          maxResultCount: Math.min(maxResults, 20),
          languageCode: "en",
        }),
        signal: AbortSignal.timeout(FETCH_TIMEOUT),
      });

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        notes.push(`Google Places HTTP ${res.status}: ${body.slice(0, 200)}`);
        return [];
      }

      const json = (await res.json()) as { places?: PlaceResult[] };
      return json.places ?? [];
    } catch (error) {
      notes.push(`Text Search failed: ${error instanceof Error ? error.message : "network error"}`);
      return [];
    }
  }

  private static toPlacesLead(
    place: PlaceResult,
    request: { category: string; city: string }
  ): GooglePlacesLead | null {
    const name = place.displayName?.text?.trim();
    if (!name || !place.id) return null;

    const website = place.websiteUri?.trim() || null;
    const phone = place.nationalPhoneNumber?.trim() || place.internationalPhoneNumber?.trim() || null;
    const rating = typeof place.rating === "number" ? place.rating : null;
    const reviewCount = typeof place.userRatingCount === "number" ? place.userRatingCount : null;

    const hours = place.currentOpeningHours?.weekdayDescriptions
      ?? place.regularOpeningHours?.weekdayDescriptions;
    const openingHours = hours ? hours.slice(0, 3).join("; ") : null;

    const lat = place.location?.latitude ?? null;
    const lng = place.location?.longitude ?? null;
    const photos = (place.photos ?? []).slice(0, 3).map((p) => p.name ?? "").filter(Boolean);
    const types = place.types ?? [];

    const priority = GooglePlacesDiscoveryService.tier(website, rating, reviewCount);
    const priorityReason = GooglePlacesDiscoveryService.explainTier(priority, website, rating, reviewCount, phone);
    const fitScore = GooglePlacesDiscoveryService.score(priority, rating, reviewCount, phone, website);

    return {
      companyName: name,
      website,
      industry: request.category,
      location: place.formattedAddress ?? null,
      phone,
      rating,
      reviewCount,
      openingHours,
      lat,
      lng,
      placeId: place.id,
      googleMapsUrl: place.googleMapsUri ?? null,
      photos,
      priceLevel: place.priceLevel ?? null,
      priority,
      priorityReason,
      suggestedHook: null,
      sourceQuery: `${request.category} in ${request.city}`,
      sourceUrl: place.googleMapsUri ?? null,
      fitScore,
      businessStatus: place.businessStatus ?? null,
      types,
    };
  }

  private static tier(
    website: string | null,
    rating: number | null,
    reviewCount: number | null
  ): GooglePlacesPriority {
    const hasWebsite = Boolean(website);
    const lowReviews = !reviewCount || reviewCount < 20;
    const lowRating = !rating || rating < 4.0;

    if (!hasWebsite && lowReviews) return "Hot";
    if (!hasWebsite || (lowReviews && lowRating)) return "Warm";
    return "Cold";
  }

  private static explainTier(
    priority: GooglePlacesPriority,
    website: string | null,
    rating: number | null,
    reviewCount: number | null,
    phone: string | null
  ): string {
    if (priority === "Hot") {
      const parts = [];
      if (!website) parts.push("no website");
      if (!reviewCount || reviewCount < 20) parts.push(`only ${reviewCount ?? 0} reviews`);
      if (!phone) parts.push("no phone listed");
      return parts.join(", ") + " — high potential for digital services";
    }
    if (priority === "Warm") {
      if (!website) return `no website, ${reviewCount ?? 0} reviews — needs online presence`;
      return `${rating?.toFixed(1) ?? "?"} stars, ${reviewCount ?? 0} reviews — could improve visibility`;
    }
    return `has website, ${rating?.toFixed(1) ?? "?"} stars with ${reviewCount ?? 0} reviews`;
  }

  private static score(
    priority: GooglePlacesPriority,
    rating: number | null,
    reviewCount: number | null,
    phone: string | null,
    website: string | null
  ): number {
    let s = priority === "Hot" ? 80 : priority === "Warm" ? 55 : 25;
    if (!website) s += 8;
    if (phone) s += 3;
    if (rating && rating >= 4.0) s += 3;
    if (reviewCount && reviewCount >= 10 && reviewCount < 50) s += 4;
    if (reviewCount && reviewCount < 10) s += 6;
    return Math.max(0, Math.min(s, 98));
  }

  private static async suggestHooks(
    leads: GooglePlacesLead[],
    category: string
  ): Promise<Map<string, string> | null> {
    if (leads.length === 0) return null;
    const result = await LlmService.completeJson(
      `You are a B2B outreach specialist. For each local ${category} business, draft ONE short outreach angle (max 140 chars) based on their Google Maps profile. Focus on what they're missing (no website, low reviews, etc.) or how they could grow. These are educated SUGGESTIONS, never stated as facts. Respond with JSON: {"places":[{"placeId":"...","hook":"..."}]}`,
      leads
        .map((l) => `${l.placeId} | ${l.companyName} | ${category} | website: ${l.website ?? "none"} | rating: ${l.rating ?? "none"} | reviews: ${l.reviewCount ?? 0} | phone: ${l.phone ?? "none"}`)
        .join("\n")
    );
    if (!result.ok || !result.text) return null;
    const parsed = LlmService.parseJsonLoose(result.text);
    if (!parsed || !Array.isArray(parsed.places)) return null;

    const hooks = new Map<string, string>();
    const ids = new Set(leads.map((l) => l.placeId));
    for (const entry of parsed.places as { placeId?: string; hook?: string }[]) {
      if (typeof entry.placeId !== "string" || typeof entry.hook !== "string") continue;
      const text = entry.hook.trim();
      if (text.length === 0 || !ids.has(entry.placeId)) continue;
      hooks.set(entry.placeId, text.slice(0, 160));
    }
    return hooks.size > 0 ? hooks : null;
  }
}
