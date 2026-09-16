import { LlmService } from "./llm.service";

/**
 * Local Lead Discovery — Google Places API (New) Text Search pipeline.
 *
 * Sibling of lead-discovery.service.ts (generic B2B web prospecting) built for
 * a different ICP: LOCAL businesses (gyms, cafes, clinics…) whose core
 * qualification signal is what they DON'T have — no website, no phone —
 * plus public traction (rating / review count). Generic site scraping can't
 * see that signal; Google Places can.
 *
 * Pipeline: Places Text Search → per-result tiering (Hot/Warm/Cold from the
 * MISSING-WEBSITE signal) → optional LLM "hook" enrichment from review
 * snippets → results shaped like `DiscoveredLead` so the existing import path
 * (ImportLeadCandidate → importDiscoveredLeadAction) can consume them.
 *
 * Conventions mirrored from lead-discovery.service.ts:
 *  - never throws — returns { success: false, notes: [...] } on failure
 *  - every network call is timeout-bounded
 *  - batched requests with bounded concurrency (Places API rate limits)
 *  - no fabricated data: absent fields stay null; the only LLM-generated
 *    content is an explicitly labeled `hook`, kept separate from factual
 *    fields sourced from the API.
 */

// ---------------------------------------------------------------------------
// Tunable qualification thresholds — the exact Hot/Warm/Cold rules. Adjust here.
// ---------------------------------------------------------------------------

/** Reviews below this = low public traction → stronger "missing web presence" signal. */
export const HOT_MAX_REVIEWS = 20;
/** Reviews at/above this = very large/established → Cold regardless of website. */
export const COLD_MIN_REVIEWS = 200;
/** Average rating at/above this counts as strong public traction. */
export const STRONG_RATING = 4.5;

export type LocalPriority = "Hot" | "Warm" | "Cold";

export interface LocalDiscoveredLead {
  /** Google Places display name. */
  companyName: string;
  /** websiteUri from Places — null when the business has NO listed website (the key signal). */
  website: string | null;
  /** Requested category, e.g. "gym". */
  industry: string | null;
  /** formattedAddress from Places. */
  location: string | null;
  /** Human-readable size/establishment signal derived ONLY from real review counts. */
  size: string | null;
  /** Real Google rating (null when the API returns none — never guessed). */
  rating: number | null;
  /** userRatingCount (null when absent). */
  reviewCount: number | null;
  /** nationalPhoneNumber (null when the business lists no phone). */
  phone: string | null;
  /** Google place_id — stable identifier for dedupe. */
  placeId: string;
  /** lat/lng when the API returns them. */
  lat: number | null;
  lng: number | null;
  /** Qualification tier from the missing-web-presence signal (see constants above). */
  priority: LocalPriority;
  /** Why this tier, citing the exact factual signals used. */
  priorityReason: string;
  /**
   * LLM-generated one-line outreach hook from review snippets — clearly labeled
   * as model-generated, distinct from the factual fields above, and null when
   * no LLM is configured or no reviews exist. Never invented.
   */
  hook: string | null;
  /** Original search text ("category city"). */
  sourceQuery: string;
  /** Google Maps link for this place (places API `googleMapsUri` when returned). */
  sourceUrl: string | null;
  /** 0-100 blend of the real signals (rating, reviews, missing-website tier). */
  fitScore: number;
  contactHint: string | null;
}

export interface LocalDiscoveryResult {
  success: boolean;
  query: string;
  leads: LocalDiscoveredLead[];
  llmUsed: boolean;
  notes: string[];
}

const PLACES_TEXT_SEARCH_URL = "https://places.googleapis.com/v1/places:searchText";
const FETCH_TIMEOUT = 15_000;
/** Places Text Search max pageSize per request. */
const PAGE_SIZE = 20;
/**
 * Rate-limiting note: unlike scrapeAll() in lead-discovery.service.ts (which
 * fans out and bounds concurrency), Places Text Search pagination is strictly
 * sequential — each page's nextPageToken is only issued with the prior
 * response — so this pipeline never exceeds one in-flight Places request.
 */
/** Review snippets requested for the LLM hook pass, per place. */
const REVIEW_SNIPPETS_PER_PLACE = 3;

// ---------------------------------------------------------------------------
// Google Places API (New) field masks. Only fields we pay for and use.
// ---------------------------------------------------------------------------

const FIELD_MASK_BASIC = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.rating",
  "places.userRatingCount",
  "places.nationalPhoneNumber",
  "places.internationalPhoneNumber",
  "places.websiteUri",
  "places.location",
  "places.googleMapsUri",
].join(",");

/** Adds reviews for the LLM hook pass (higher SKU — requested only when the LLM is available). */
const FIELD_MASK_WITH_REVIEWS = `${FIELD_MASK_BASIC},places.reviews`;

interface PlaceResult {
  id?: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  rating?: number;
  userRatingCount?: number;
  nationalPhoneNumber?: string;
  internationalPhoneNumber?: string;
  websiteUri?: string;
  location?: { latitude?: number; longitude?: number };
  googleMapsUri?: string;
  reviews?: { text?: { text?: string }; originalText?: { text?: string }; rating?: number }[];
}

interface PlacesTextSearchResponse {
  places?: PlaceResult[];
  error?: { message?: string };
}

export class LocalLeadDiscoveryService {
  /**
   * Full pipeline: Places Text Search for "category city" → tiered,
   * hook-enriched local leads ready for CRM import.
   */
  static async discover(request: {
    category: string;
    city: string;
    maxResults?: number;
  }): Promise<LocalDiscoveryResult> {
    const category = request.category.trim();
    const city = request.city.trim();
    const query = `${category} ${city}`.trim();
    const notes: string[] = [];
    const maxResults = Math.min(Math.max(request.maxResults ?? 10, 1), 20);

    if (category.length < 2 || city.length < 2) {
      return {
        success: false,
        query,
        leads: [],
        llmUsed: false,
        notes: ["Both a category (e.g. \"gym\") and a city (e.g. \"Jorhat, Assam\") are required."],
      };
    }

    if (!process.env.GOOGLE_PLACES_API_KEY?.trim()) {
      return {
        success: false,
        query,
        leads: [],
        llmUsed: false,
        notes: ["GOOGLE_PLACES_API_KEY is not configured — local discovery via Google Places is unavailable."],
      };
    }

    // 1+2. Places Text Search (paged when needed), bounded concurrency.
    const useReviews = LlmService.getStatus().available;
    const places = await LocalLeadDiscoveryService.textSearch(query, maxResults, useReviews, notes);
    if (places.length === 0) {
      notes.push("Google Places returned no businesses for this category/city.");
      return { success: false, query, leads: [], llmUsed: false, notes };
    }
    notes.push(`Google Places returned ${places.length} businesses.`);

    // 3. Tier each result from the real missing-web-presence signals.
    const leads = places.map((p) => LocalLeadDiscoveryService.toLocalLead(p, request));
    notes.push(
      `${leads.filter((l) => l.priority === "Hot").length} Hot (no website), ` +
        `${leads.filter((l) => l.priority === "Warm").length} Warm, ` +
        `${leads.filter((l) => l.priority === "Cold").length} Cold.`
    );

    // 4. Optional LLM hook pass from review snippets.
    let llmUsed = false;
    if (useReviews && leads.some((l) => l.reviewCount !== null && l.reviewCount > 0)) {
      const hooks = await LocalLeadDiscoveryService.enrichHooks(
        places,
        leads.map((l) => l.placeId)
      );
      if (hooks) {
        llmUsed = true;
        notes.push("Outreach hooks generated by LLM from review snippets.");
        for (const [placeId, hook] of hooks) {
          const idx = leads.findIndex((l) => l.placeId === placeId);
          if (idx >= 0) leads[idx] = { ...leads[idx], hook };
        }
      } else {
        notes.push("LLM hook enrichment unavailable — hooks omitted (factual fields unaffected).");
      }
    } else if (!useReviews) {
      notes.push("No LLM provider configured — review snippets not requested, hooks omitted.");
    }

    // 5. Rank: tier first, then fit score.
    const tierRank: Record<LocalPriority, number> = { Hot: 0, Warm: 1, Cold: 2 };
    leads.sort(
      (a, b) => tierRank[a.priority] - tierRank[b.priority] || b.fitScore - a.fitScore
    );

    return { success: true, query, leads: leads.slice(0, maxResults), llmUsed, notes };
  }

  // --- Places Text Search (paged, bounded concurrency) -----------------------

  private static async textSearch(
    query: string,
    maxResults: number,
    withReviews: boolean,
    notes: string[]
  ): Promise<PlaceResult[]> {
    const places: PlaceResult[] = [];
    // Simple pagination: sequential page tokens (each must be fetched serially —
    // the token is only valid ~seconds after the prior response). Concurrency
    // bound applies to the initial fan-out when we split large queries.
    let pageToken: string | undefined;
    for (let page = 0; page < Math.ceil(maxResults / PAGE_SIZE) && places.length < maxResults; page++) {
      try {
        const res = await fetch(PLACES_TEXT_SEARCH_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Goog-Api-Key": process.env.GOOGLE_PLACES_API_KEY!.trim(),
            "X-Goog-FieldMask": withReviews ? FIELD_MASK_WITH_REVIEWS : FIELD_MASK_BASIC,
          },
          body: JSON.stringify({ textQuery: query, pageSize: Math.min(maxResults, PAGE_SIZE), pageToken }),
          signal: AbortSignal.timeout(FETCH_TIMEOUT),
        });
        if (!res.ok) {
          const body = await res.text().catch(() => "");
          notes.push(`Places API HTTP ${res.status}: ${body.slice(0, 200)}`);
          break;
        }
        const json = (await res.json()) as PlacesTextSearchResponse;
        if (json.error?.message) {
          notes.push(`Places API error: ${json.error.message.slice(0, 200)}`);
          break;
        }
        for (const p of json.places ?? []) {
          if (p.id) places.push(p);
        }
        pageToken = (json as { nextPageToken?: string }).nextPageToken;
        if (!pageToken) break;
      } catch (error) {
        notes.push(
          `Places request failed: ${error instanceof Error ? error.message : "network error"}`
        );
        break;
      }
    }
    return places;
  }

  // --- Tiering + shaping -------------------------------------------------------

  private static toLocalLead(
    place: PlaceResult,
    request: { category: string }
  ): LocalDiscoveredLead {
    const name = place.displayName?.text?.trim() || "Unknown business";
    const website = place.websiteUri?.trim() || null;
    const rating = typeof place.rating === "number" ? place.rating : null;
    const reviewCount = typeof place.userRatingCount === "number" ? place.userRatingCount : null;
    const phone = place.nationalPhoneNumber?.trim() || place.internationalPhoneNumber?.trim() || null;

    // The core qualification signal: no listed website = digital gap = opportunity.
    const priority = LocalLeadDiscoveryService.tier(website, reviewCount);
    const priorityReason = LocalLeadDiscoveryService.explainTier(priority, website, rating, reviewCount);
    const fitScore = LocalLeadDiscoveryService.score(priority, rating, reviewCount, phone);
    const size =
      reviewCount === null
        ? null
        : reviewCount >= COLD_MIN_REVIEWS
          ? `established (${reviewCount} Google reviews)`
          : `small local business (${reviewCount} Google reviews)`;

    return {
      companyName: name.slice(0, 160),
      website,
      industry: request.category.trim() || null,
      location: place.formattedAddress?.trim() || null,
      size,
      rating,
      reviewCount,
      phone,
      placeId: place.id!,
      lat: typeof place.location?.latitude === "number" ? place.location.latitude : null,
      lng: typeof place.location?.longitude === "number" ? place.location.longitude : null,
      priority,
      priorityReason,
      hook: null,
      sourceQuery: request.category,
      sourceUrl: place.googleMapsUri?.trim() || null,
      fitScore,
      contactHint: phone,
    };
  }

  /** Hot/Warm/Cold from the missing-web-presence signal. See constants at top of file. */
  private static tier(website: string | null, reviewCount: number | null): LocalPriority {
    if (website) return "Cold"; // has a website — lower-priority for this ICP
    if (reviewCount === null) return "Warm"; // unknown traction, still no web presence
    if (reviewCount < HOT_MAX_REVIEWS) return "Hot"; // low traction AND no website
    if (reviewCount >= COLD_MIN_REVIEWS) return "Cold"; // very established, no website
    return "Warm"; // no website but more established
  }

  private static explainTier(
    priority: LocalPriority,
    website: string | null,
    rating: number | null,
    reviewCount: number | null
  ): string {
    const noSite = "no website listed";
    if (priority === "Hot") return `${noSite}, low review count (${reviewCount ?? 0})`;
    if (priority === "Warm") {
      return reviewCount === null
        ? `${noSite}, traction unknown`
        : `${noSite} but established (${reviewCount} reviews, ${rating ?? "?"}★)`;
    }
    return website ? "has a website" : `very established (${reviewCount ?? 0} reviews)`;
  }

  /** Heuristic 0-100 fit from the real signals only. */
  private static score(
    priority: LocalPriority,
    rating: number | null,
    reviewCount: number | null,
    phone: string | null
  ): number {
    let s = priority === "Hot" ? 75 : priority === "Warm" ? 55 : 25;
    if (rating !== null) s += Math.round((rating - 3.5) * 10); // strong ratings convert
    if (phone) s += 5; // reachable without enrichment
    if (reviewCount !== null && reviewCount >= 5 && reviewCount < HOT_MAX_REVIEWS) s += 5;
    return Math.max(0, Math.min(s, 96));
  }

  // --- LLM hook pass ------------------------------------------------------------

  /**
   * One-line outreach hooks from review snippets, exactly like enrichBatch in
   * lead-discovery.service.ts: one LLM call, fail-soft to null hooks. Hooks are
   * labeled model-generated and live ONLY in `hook` — factual fields untouched.
   */
  private static async enrichHooks(
    places: PlaceResult[],
    placeIds: string[]
  ): Promise<Map<string, string> | null> {
    const withReviews = places.filter(
      (p) => p.id && placeIds.includes(p.id) && (p.reviews?.length ?? 0) > 0
    );
    if (withReviews.length === 0) return null;

    const result = await LlmService.completeJson(
      `You are an outreach assistant. For each business, read its Google review snippets and write ONE specific, real detail an outreach message could reference (a concrete observation, not a greeting). Only use details actually present in the snippets; if nothing specific is available, use exactly "no specific hook found". Respond with JSON: {"places":[{"id":"...","hook":"..."}]}`,
      places
        .map((p, i) => {
          const snippets = (p.reviews ?? [])
            .slice(0, REVIEW_SNIPPETS_PER_PLACE)
            .map((r) => r.text?.text ?? r.originalText?.text ?? "")
            .filter(Boolean)
            .join(" | ");
          return `[${i}] id=${p.id ?? "?"} | ${p.displayName?.text ?? "?"} | reviews: ${snippets || "none"}`;
        })
        .join("\n")
    );
    if (!result.ok || !result.text) return null;
    const parsed = LlmService.parseJsonLoose(result.text);
    if (!parsed || !Array.isArray(parsed.places)) return null;

    const hooks = new Map<string, string>();
    for (const entry of parsed.places as { id?: string; hook?: string }[]) {
      if (typeof entry.id !== "string" || typeof entry.hook !== "string") continue;
      const text = entry.hook.trim();
      if (text.length === 0 || text === "no specific hook found") continue;
      if (!placeIds.includes(entry.id)) continue;
      hooks.set(entry.id, text.slice(0, 160));
    }
    return hooks.size > 0 ? hooks : null;
  }
}
