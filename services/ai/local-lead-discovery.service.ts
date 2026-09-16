import { LlmService } from "./llm.service";

/**
 * Local Lead Discovery — OpenStreetMap (Nominatim + Overpass) pipeline.
 *
 * Sibling of lead-discovery.service.ts (generic B2B web prospecting) built for
 * a different ICP: LOCAL businesses (gyms, cafes, clinics…) in specific
 * cities, qualified on what they DON'T have — no website, ideally no phone.
 * OSM has no ratings/review counts, so the qualification signal is the
 * missing-web-presence fields themselves.
 *
 * Pipeline: Nominatim geocode (city → bbox) → Overpass QL query (category tag
 * within bbox) → tag parsing (nulls stay null) → website/phone tiering →
 * optional LLM `suggestedHook` (a labeled SUGGESTION, never merged into the
 * factual fields) → results shaped like `DiscoveredLead` so the existing
 * import path (ImportLeadCandidate → importDiscoveredLeadAction) consumes them.
 *
 * Conventions mirrored from lead-discovery.service.ts:
 *  - never throws — returns { success: false, notes: [...] } on failure
 *  - every network call is timeout-bounded
 *  - sequential requests with delays (Nominatim ~1 rps, Overpass fair use)
 *
 * FREE + KEYLESS by design: no API key, no billing, no quota — these are
 * shared public OSM services, so usage stays polite (descriptive User-Agent,
 * 1 req/s geocoding queue, small Overpass delays).
 */

// ---------------------------------------------------------------------------
// Tunable qualification thresholds — the exact Hot/Warm/Cold rules. Adjust here.
// ---------------------------------------------------------------------------

export type LocalPriority = "Hot" | "Warm" | "Cold";

/**
 * LLM outreach-angle suggestions per batch (one call, not per-lead).
 * 0 disables the pass entirely.
 */
const HOOK_MAX_LEADS = 20;
/** Delay between successive Nominatim requests (usage policy: ~1 req/s). */
const NOMINATIM_MIN_INTERVAL_MS = 1_100;
/** Polite pause between Overpass requests (fair use; queries are rate-limited). */
const OVERPASS_MIN_INTERVAL_MS = 700;
/** Overpass QL's own server-side timeout — kept modest for fair use. */
const OVERPASS_QL_TIMEOUT_S = 25;

// --- OSM usage-policy identity (required by Nominatim; describe your app) ---
const USER_AGENT = "Aexyl-CRM/1.0 (local business lead discovery; contact: operator@aexyl.local)";

export interface LocalDiscoveredLead {
  /** OSM name tag (null when the element is unnamed — rare for businesses). */
  companyName: string | null;
  /** website or contact:website tag — null when the business has NO listed website (the key signal). */
  website: string | null;
  /** Requested category, e.g. "gym". */
  industry: string | null;
  /** Address assembled ONLY from addr:* tags actually present (null when none). */
  location: string | null;
  /** The OSM tag that matched (e.g. "leisure=fitness_centre") — provenance, not inference. */
  size: string | null;
  /** phone or contact:phone tag (null when absent). */
  phone: string | null;
  /** opening_hours tag (null when absent). */
  openingHours: string | null;
  /** Element latitude (null when absent). */
  lat: number | null;
  /** Element longitude (null when absent). */
  lng: number | null;
  /** Stable OSM identity: "node/123", "way/456", "relation/789". */
  osmId: string;
  /** Qualification tier from the missing-web-presence signal (see constants above). */
  priority: LocalPriority;
  /** Why this tier, citing the exact factual signals used. */
  priorityReason: string;
  /**
   * LLM-drafted one-line outreach angle — a SUGGESTION clearly labeled as
   * model-generated, kept permanently separate from the factual OSM fields
   * above. Null when no LLM is configured. Never invented facts.
   */
  suggestedHook: string | null;
  /** Original query ("category city"). */
  sourceQuery: string;
  /** OSM browse link for this element. */
  sourceUrl: string | null;
  /** 0-100 heuristic from the real signals (tier + reachability + opening hours). */
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

// --- Category → Overpass tag mapping (top-of-file, easy to adjust) -----------

const CATEGORY_TAG_MAP: Record<string, string[]> = {
  gym: ["leisure=fitness_centre", "leisure=sports_centre", "amenity=gym"],
  fitness: ["leisure=fitness_centre", "leisure=sports_centre"],
  cafe: ["amenity=cafe"],
  coffee: ["amenity=cafe"],
  restaurant: ["amenity=restaurant"],
  clinic: ["amenity=clinic", "amenity=doctors"],
  dental: ["amenity=dentist"],
  salon: ["shop=hairdresser", "shop=beauty"],
  spa: ["leisure=spa", "shop=beauty"],
  hotel: ["tourism=hotel"],
  bakery: ["shop=bakery"],
  bar: ["amenity=bar", "amenity=pub"],
  pharmacy: ["amenity=pharmacy"],
  supermarket: ["shop=supermarket"],
};

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
const FETCH_TIMEOUT = 30_000;
const GEOFETCH_TIMEOUT = 12_000;

interface NominatimResult {
  boundingbox?: string[];
  lat?: string;
  lon?: string;
  display_name?: string;
}

interface OverpassElement {
  type?: string;
  id?: number;
  lat?: number;
  lon?: number;
  center?: { lat?: number; lon?: number };
  tags?: Record<string, string>;
}

/** Serialize Nominatim calls — the usage policy allows ~1 request/second. */
let lastNominatimAt = 0;
async function nominatimGate(): Promise<void> {
  const wait = NOMINATIM_MIN_INTERVAL_MS - (Date.now() - lastNominatimAt);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastNominatimAt = Date.now();
}
/** Serialize Overpass calls — polite pause between fair-use queries. */
let lastOverpassAt = 0;
async function overpassGate(): Promise<void> {
  const wait = OVERPASS_MIN_INTERVAL_MS - (Date.now() - lastOverpassAt);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastOverpassAt = Date.now();
}

export class LocalLeadDiscoveryService {
  /**
   * Full pipeline: geocode city → Overpass category query → tiered leads.
   * Free, keyless, and fail-soft end to end.
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
    const maxResults = Math.min(Math.max(request.maxResults ?? 10, 1), 30);

    if (category.length < 2 || city.length < 2) {
      return {
        success: false,
        query,
        leads: [],
        llmUsed: false,
        notes: ["Both a category (e.g. \"gym\") and a city (e.g. \"Jorhat, Assam\") are required."],
      };
    }

    // 1. Geocode the city to a bounding box (Nominatim, queued at ~1 rps).
    const bbox = await LocalLeadDiscoveryService.geocodeCity(city, notes);
    if (!bbox) {
      notes.push(`Could not geocode "${city}" — check the city name or try \"City, Region\".`);
      return { success: false, query, leads: [], llmUsed: false, notes };
    }
    notes.push(`Located ${city} via OpenStreetMap geocoding.`);

    // 2. Overpass query per mapped tag, sequential (fair-use pacing).
    const tags = LocalLeadDiscoveryService.tagsForCategory(category);
    if (tags.length === 0) {
      notes.push(
        `No OSM tag mapping for "${category}" — add one to CATEGORY_TAG_MAP (e.g. shop=clothes). Falling back to a name search.`
      );
    }

    const elements = await LocalLeadDiscoveryService.overpassQuery(bbox, tags, category, notes);
    if (elements.length === 0) {
      notes.push("Overpass returned no matching businesses in this area.");
      return { success: false, query, leads: [], llmUsed: false, notes };
    }
    notes.push(`OpenStreetMap returned ${elements.length} matching elements.`);

    // 3. Parse tags → clean shape (nulls stay null), dedupe by osmId.
    const seen = new Set<string>();
    let leads: LocalDiscoveredLead[] = [];
    for (const el of elements) {
      const lead = LocalLeadDiscoveryService.toLocalLead(el, request);
      if (!lead || seen.has(lead.osmId)) continue;
      seen.add(lead.osmId);
      leads.push(lead);
      if (leads.length >= maxResults) break;
    }
    if (leads.length === 0) {
      notes.push("No named businesses found in the OSM results.");
      return { success: false, query, leads: [], llmUsed: false, notes };
    }

    const hot = leads.filter((l) => l.priority === "Hot").length;
    notes.push(`${hot} Hot (no website, no phone), ${leads.filter((l) => l.priority === "Warm").length} Warm (no website, has phone), ${leads.filter((l) => l.priority === "Cold").length} Cold (has website).`);

    // 4. Optional LLM suggestedHook pass (labeled suggestions, fail-soft).
    let llmUsed = false;
    if (LlmService.getStatus().available) {
      const hooks = await LocalLeadDiscoveryService.suggestHooks(leads.slice(0, HOOK_MAX_LEADS), category);
      if (hooks) {
        llmUsed = true;
        notes.push("Outreach angles drafted by LLM (suggestions only — verify before use).");
        for (const [osmId, hook] of hooks) {
          const idx = leads.findIndex((l) => l.osmId === osmId);
          if (idx >= 0) leads[idx] = { ...leads[idx], suggestedHook: hook };
        }
      } else {
        notes.push("LLM unavailable — outreach-angle suggestions omitted (factual fields unaffected).");
      }
    }

    // 5. Rank: tier first, then fit score.
    const tierRank: Record<LocalPriority, number> = { Hot: 0, Warm: 1, Cold: 2 };
    leads = leads
      .sort((a, b) => tierRank[a.priority] - tierRank[b.priority] || b.fitScore - a.fitScore)
      .slice(0, maxResults);

    return { success: true, query, leads, llmUsed, notes };
  }

  // --- Step 1: Nominatim geocoding (queued at ~1 rps) -------------------------

  private static async geocodeCity(city: string, notes: string[]): Promise<string | null> {
    await nominatimGate();
    try {
      const url = `${NOMINATIM_URL}?q=${encodeURIComponent(city)}&format=json&limit=1`;
      const res = await fetch(url, {
        headers: { "User-Agent": USER_AGENT, "Accept-Language": "en" },
        signal: AbortSignal.timeout(GEOFETCH_TIMEOUT),
      });
      if (!res.ok) {
        notes.push(`Nominatim HTTP ${res.status}.`);
        return null;
      }
      const json = (await res.json()) as NominatimResult[];
      const hit = json[0];
      if (!hit?.boundingbox || hit.boundingbox.length !== 4) {
        return null;
      }
      // Nominatim bbox order: south, north, west, east → Overpass order:
      // south, west, north, east (consumed via the global [bbox:…] setting).
      const [south, north, west, east] = hit.boundingbox;
      return `${south},${west},${north},${east}`;
    } catch (error) {
      notes.push(`Geocoding failed: ${error instanceof Error ? error.message : "network error"}`);
      return null;
    }
  }

  // --- Step 2: Overpass QL (sequential, QL-level timeout) ----------------------

  private static tagsForCategory(category: string): string[] {
    const key = category.toLowerCase().trim();
    for (const [name, tags] of Object.entries(CATEGORY_TAG_MAP)) {
      if (key.includes(name)) return tags;
    }
    return [];
  }

  private static async overpassQuery(
    bbox: string,
    tags: string[],
    category: string,
    notes: string[]
  ): Promise<OverpassElement[]> {
    // Global [bbox:…] bounds every selector; mapped categories query each tag,
    // unknown categories fall back to a name search.
    const selectors =
      tags.length > 0
        ? tags.map((t) => `nwr[${t}];`).join("")
        : `nwr["name"~"${category.replace(/[^\p{L}\p{N}\s-]/gu, "").trim()}",i];`;

    const ql = `[out:json][timeout:${OVERPASS_QL_TIMEOUT_S}][bbox:${bbox}];(${selectors});out center tags ${Math.max(1, OVERPASS_MAX_ELEMENTS)};`;

    await overpassGate();
    // One polite retry: the public endpoint intermittently answers 504 under
    // load; a short backoff usually clears it without hammering.
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetch(OVERPASS_URL, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": USER_AGENT },
          body: `data=${encodeURIComponent(ql)}`,
          signal: AbortSignal.timeout(FETCH_TIMEOUT),
        });
        if (!res.ok) {
          const body = await res.text().catch(() => "");
          if (res.status >= 500 && attempt === 0) {
            await new Promise((r) => setTimeout(r, 2_000));
            continue;
          }
          notes.push(`Overpass HTTP ${res.status}: ${body.slice(0, 160)}`);
          return [];
        }
        const json = (await res.json()) as { elements?: OverpassElement[] };
        return json.elements ?? [];
      } catch (error) {
        if (attempt === 0) {
          await new Promise((r) => setTimeout(r, 2_000));
          continue;
        }
        notes.push(`Overpass query failed: ${error instanceof Error ? error.message : "network error"}`);
        return [];
      }
    }
    return [];
  }

  // --- Step 3: tag parsing ------------------------------------------------------

  private static toLocalLead(el: OverpassElement, request: { category: string; city: string }): LocalDiscoveredLead | null {
    if (!el.type || typeof el.id !== "number") return null;
    const tags = el.tags ?? {};
    const name = tags.name?.trim() || null;

    const lat = typeof el.lat === "number" ? el.lat : (typeof el.center?.lat === "number" ? el.center.lat : null);
    const lng = typeof el.lon === "number" ? el.lon : (typeof el.center?.lon === "number" ? el.center.lon : null);

    // Address assembled ONLY from addr:* tags that actually exist.
    const street = [tags["addr:housenumber"], tags["addr:street"]].filter(Boolean).join(" ").trim();
    const cityPart = tags["addr:city"]?.trim() || null;
    const postcode = tags["addr:postcode"]?.trim() || null;
    const state = tags["addr:state"]?.trim() || null;
    const addressParts = [street || null, cityPart, state, postcode].filter(Boolean);
    const address = addressParts.length > 0 ? addressParts.join(", ") : null;

    const phone = tags.phone?.trim() || tags["contact:phone"]?.trim() || null;
    const website = tags.website?.trim() || tags["contact:website"]?.trim() || null;
    const openingHours = tags.opening_hours?.trim() || null;

    const matchedTag = LocalLeadDiscoveryService.matchedTag(tags) ?? `name~${request.category}`;
    const priority = LocalLeadDiscoveryService.tier(website, phone);
    const priorityReason = LocalLeadDiscoveryService.explainTier(priority, website, phone, openingHours);

    return {
      companyName: name,
      website,
      industry: request.category.trim() || null,
      location: address,
      size: matchedTag,
      phone,
      openingHours,
      lat,
      lng,
      osmId: `${el.type}/${el.id}`,
      priority,
      priorityReason,
      suggestedHook: null,
      sourceQuery: `${request.category} ${request.city ?? ""}`.trim(),
      sourceUrl: `https://www.openstreetmap.org/${el.type}/${el.id}`,
      fitScore: LocalLeadDiscoveryService.score(priority, phone, openingHours),
      contactHint: phone,
    };
  }

  private static matchedTag(tags: Record<string, string>): string | null {
    for (const candidates of Object.values(CATEGORY_TAG_MAP)) {
      for (const tag of candidates) {
        const [k, v] = tag.split("=");
        if (tags[k] === v) return tag;
      }
    }
    return null;
  }

  /** Hot/Warm/Cold from what OSM actually provides. See constants at top of file. */
  private static tier(website: string | null, phone: string | null): LocalPriority {
    if (website) return "Cold"; // has a website — lower-priority for this ICP
    if (phone) return "Warm"; // no website but reachable by phone
    return "Hot"; // no website AND no phone — the core qualification signal
  }

  private static explainTier(
    priority: LocalPriority,
    website: string | null,
    phone: string | null,
    openingHours: string | null
  ): string {
    const noSite = "no website listed";
    if (priority === "Hot") return `${noSite}, no phone listed${openingHours ? " — likely walk-in/word-of-mouth business" : ""}`;
    if (priority === "Warm") return `${noSite}, reachable by phone`;
    return "has a listed website";
  }

  /** Heuristic 0-100 fit from the real signals only. */
  private static score(priority: LocalPriority, phone: string | null, openingHours: string | null): number {
    let s = priority === "Hot" ? 78 : priority === "Warm" ? 60 : 25;
    if (phone) s += 5; // reachable without enrichment
    if (openingHours) s += 4; // established/curated listing
    return Math.max(0, Math.min(s, 96));
  }

  // --- LLM suggestedHook pass -----------------------------------------------------

  /**
   * One LLM call per batch drafting generic outreach ANGLES from name+category
   * alone — explicitly suggestions, never presented as facts about the
   * business. Fail-soft to null, same pattern as enrichBatch in the sibling.
   */
  private static async suggestHooks(
    leads: LocalDiscoveredLead[],
    category: string
  ): Promise<Map<string, string> | null> {
    if (leads.length === 0) return null;
    const result = await LlmService.completeJson(
      `You are an outreach assistant for a web-design agency. For each ${category}, draft ONE short outreach angle (max 140 chars) that a first message could use — e.g. "no website listed — likely relying on walk-in/word-of-mouth". These are educated SUGGESTIONS based only on the given data, never stated as facts. Respond with JSON: {"places":[{"osmId":"...","hook":"..."}]}`,
      leads
        .map((l) => `${l.osmId} | ${l.companyName ?? "unnamed"} | ${category} | website: ${l.website ?? "none"} | phone: ${l.phone ?? "none"}`)
        .join("\n")
    );
    if (!result.ok || !result.text) return null;
    const parsed = LlmService.parseJsonLoose(result.text);
    if (!parsed || !Array.isArray(parsed.places)) return null;

    const hooks = new Map<string, string>();
    const ids = new Set(leads.map((l) => l.osmId));
    for (const entry of parsed.places as { osmId?: string; hook?: string }[]) {
      if (typeof entry.osmId !== "string" || typeof entry.hook !== "string") continue;
      const text = entry.hook.trim();
      if (text.length === 0 || !ids.has(entry.osmId)) continue;
      hooks.set(entry.osmId, text.slice(0, 160));
    }
    return hooks.size > 0 ? hooks : null;
  }
}

/** Hard cap on elements per Overpass response (fair use + prompt hygiene). */
const OVERPASS_MAX_ELEMENTS = 60;
