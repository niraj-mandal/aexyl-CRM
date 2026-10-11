import { LlmService } from "./llm.service";

/**
 * Business discovery aggregator — tries the local Docker Google Maps scraper
 * first (real Google Maps data: ratings, reviews, emails, phones), then falls
 * back to Nominatim + Photon (free OSM-based).
 *
 * Pipeline: Docker scraper API (localhost:8080) → Nominatim + Photon → merge →
 * tier on missing-web-presence → optional LLM outreach hooks → sorted leads.
 */

const DOCKER_SCRAPER_BASE = "http://localhost:8080";
const DOCKER_SCRAPER_TIMEOUT = 180_000;
const DOCKER_POLL_INTERVAL = 8_000;
const FETCH_TIMEOUT = 15_000;
const NOMINATIM_TIMEOUT = 12_000;
const HOOK_MAX_LEADS = 20;
const USER_AGENT = "AexylCRM/1.0 (local business discovery)";

const CATEGORY_RELEVANT_TYPES: Record<string, string[]> = {
  gym: ["fitness_centre", "sports_centre", "gym"],
  fitness: ["fitness_centre", "sports_centre", "gym"],
  cafe: ["cafe"],
  coffee: ["cafe"],
  restaurant: ["restaurant", "fast_food"],
  clinic: ["clinic", "doctors"],
  dental: ["dentist"],
  salon: ["hairdresser", "beauty"],
  spa: ["spa", "beauty"],
  hotel: ["hotel", "motel", "hostel"],
  bakery: ["bakery"],
  bar: ["bar", "pub"],
  pharmacy: ["pharmacy"],
  supermarket: ["supermarket", "convenience"],
};

let lastNominatimAt = 0;
async function nominatimGate(): Promise<void> {
  const wait = 1100 - (Date.now() - lastNominatimAt);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastNominatimAt = Date.now();
}

export type ScrapedPriority = "Hot" | "Warm" | "Cold";

export interface ScrapedGoogleLead {
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
  priceLevel: string | null;
  priority: ScrapedPriority;
  priorityReason: string;
  suggestedHook: string | null;
  sourceQuery: string;
  sourceUrl: string;
  fitScore: number;
  businessStatus: string | null;
  types: string[];
}

export interface GoogleMapsScrapeResult {
  success: boolean;
  query: string;
  leads: ScrapedGoogleLead[];
  llmUsed: boolean;
  notes: string[];
}

interface NominatimPOI {
  osm_type: string;
  osm_id: number;
  lat: string;
  lon: string;
  display_name: string;
  name: string;
  class: string;
  type: string;
  address?: Record<string, string>;
  extratags?: Record<string, string> | null;
}

interface PhotonFeature {
  geometry?: { coordinates?: number[] };
  properties?: {
    osm_id?: number;
    osm_type?: string;
    name?: string;
    city?: string;
    state?: string;
    country?: string;
    street?: string;
    housenumber?: string;
    postcode?: string;
    osm_key?: string;
    osm_value?: string;
  };
}

export class GoogleMapsScraperService {
  static async discover(request: {
    category: string;
    city: string;
    maxResults?: number;
  }): Promise<GoogleMapsScrapeResult> {
    const category = request.category.trim();
    const city = request.city.trim();
    const query = `${category} in ${city}`;
    const notes: string[] = [];
    const maxResults = Math.min(Math.max(request.maxResults ?? 10, 1), 30);

    if (category.length < 2 || city.length < 2) {
      return {
        success: false, query, leads: [], llmUsed: false,
        notes: ["Both a category and a city are required."],
      };
    }

    // Source 0: Docker Google Maps scraper (real Google data — best results)
    const dockerLeads = await GoogleMapsScraperService.dockerScrape(category, city, maxResults, notes);
    if (dockerLeads.length > 0) {
      notes.push(`Google Maps scraper found ${dockerLeads.length} businesses with real ratings and reviews.`);
      let leads = dockerLeads.slice(0, maxResults);

      const hot = leads.filter((l) => l.priority === "Hot").length;
      const warm = leads.filter((l) => l.priority === "Warm").length;
      notes.push(`${hot} Hot, ${warm} Warm, ${leads.length - hot - warm} Cold leads.`);

      let llmUsed = false;
      if (LlmService.getStatus().available) {
        const hooks = await GoogleMapsScraperService.suggestHooks(leads.slice(0, HOOK_MAX_LEADS), category);
        if (hooks) {
          llmUsed = true;
          notes.push("AI outreach angles drafted (suggestions only).");
          hooks.forEach((hook, id) => {
            const idx = leads.findIndex((l) => l.placeId === id);
            if (idx >= 0) leads[idx] = { ...leads[idx], suggestedHook: hook };
          });
        }
      }

      leads = leads
        .sort((a, b) => {
          const tier: Record<ScrapedPriority, number> = { Hot: 0, Warm: 1, Cold: 2 };
          return tier[a.priority] - tier[b.priority] || b.fitScore - a.fitScore;
        })
        .slice(0, maxResults);

      return { success: true, query, leads, llmUsed, notes };
    }

    // Fallback: Nominatim + Photon (free OSM sources)
    const allRaw: RawPOI[] = [];

    const nominatimResults = await GoogleMapsScraperService.nominatimSearch(category, city, notes);
    for (const r of nominatimResults) allRaw.push(r);

    const photonResults = await GoogleMapsScraperService.photonSearch(category, city, notes);
    for (const r of photonResults) allRaw.push(r);

    if (allRaw.length === 0) {
      notes.push(`No businesses found for "${category}" in "${city}".`);
      return { success: false, query, leads: [], llmUsed: false, notes };
    }

    const seen = new Set<string>();
    const deduped: RawPOI[] = [];
    for (const raw of allRaw) {
      if (seen.has(raw.osmKey)) continue;
      seen.add(raw.osmKey);
      deduped.push(raw);
    }

    notes.push(`Found ${deduped.length} businesses via OpenStreetMap.`);

    let leads: ScrapedGoogleLead[] = [];
    for (const raw of deduped) {
      const lead = GoogleMapsScraperService.toLead(raw, category, city);
      if (!lead) continue;
      leads.push(lead);
      if (leads.length >= maxResults) break;
    }

    if (leads.length === 0) {
      notes.push("Found OSM data but no named businesses could be extracted.");
      return { success: false, query, leads: [], llmUsed: false, notes };
    }

    const hot = leads.filter((l) => l.priority === "Hot").length;
    const warm = leads.filter((l) => l.priority === "Warm").length;
    notes.push(`${hot} Hot, ${warm} Warm, ${leads.length - hot - warm} Cold leads.`);

    // Optional LLM hooks
    let llmUsed = false;
    if (LlmService.getStatus().available) {
      const hooks = await GoogleMapsScraperService.suggestHooks(leads.slice(0, HOOK_MAX_LEADS), category);
      if (hooks) {
        llmUsed = true;
        notes.push("AI outreach angles drafted (suggestions only).");
        hooks.forEach((hook, id) => {
          const idx = leads.findIndex((l) => l.placeId === id);
          if (idx >= 0) leads[idx] = { ...leads[idx], suggestedHook: hook };
        });
      }
    }

    leads = leads
      .sort((a, b) => {
        const tier: Record<ScrapedPriority, number> = { Hot: 0, Warm: 1, Cold: 2 };
        return tier[a.priority] - tier[b.priority] || b.fitScore - a.fitScore;
      })
      .slice(0, maxResults);

    return { success: true, query, leads, llmUsed, notes };
  }

  // --- Docker Google Maps scraper (localhost:8080) ---

  private static async dockerScrape(
    category: string, city: string, maxResults: number, notes: string[]
  ): Promise<ScrapedGoogleLead[]> {
    try {
      // Health check — is the container running?
      const health = await fetch(`${DOCKER_SCRAPER_BASE}/api/v1/jobs`, {
        signal: AbortSignal.timeout(3000),
      });
      if (!health.ok) return [];
    } catch {
      return [];
    }

    try {
      // Geocode the city for lat/lon
      const coords = await GoogleMapsScraperService.geocodeCity(city);
      if (!coords) {
        notes.push("Could not geocode city for Google Maps scraper.");
        return [];
      }

      notes.push("Google Maps scraper running — creating job…");

      const body = {
        name: "copilot-discover",
        keywords: [`${category} in ${city}`],
        lang: "en",
        zoom: 15,
        lat: String(coords.lat),
        lon: String(coords.lon),
        fast_mode: false,
        radius: 10000,
        depth: 5,
        email: true,
        max_time: 180,
      };

      const createRes = await fetch(`${DOCKER_SCRAPER_BASE}/api/v1/jobs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15000),
      });
      if (!createRes.ok) {
        notes.push(`Scraper job creation failed: HTTP ${createRes.status}`);
        return [];
      }
      const { id: jobId } = (await createRes.json()) as { id?: string };
      if (!jobId) return [];

      // Poll until done
      const deadline = Date.now() + DOCKER_SCRAPER_TIMEOUT;
      let status = "";
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, DOCKER_POLL_INTERVAL));
        try {
          const pollRes = await fetch(`${DOCKER_SCRAPER_BASE}/api/v1/jobs/${jobId}`, {
            signal: AbortSignal.timeout(10000),
          });
          if (!pollRes.ok) continue;
          const pollData = (await pollRes.json()) as { Status?: string };
          status = pollData.Status ?? "";
          if (status === "ok") break;
          if (status === "failed") {
            notes.push("Scraper job failed — falling back to free sources.");
            return [];
          }
        } catch { /* retry */ }
      }
      if (status !== "ok") {
        notes.push("Scraper job timed out — falling back to free sources.");
        return [];
      }

      // Download CSV results
      const dlRes = await fetch(`${DOCKER_SCRAPER_BASE}/api/v1/jobs/${jobId}/download`, {
        signal: AbortSignal.timeout(30000),
      });
      if (!dlRes.ok) return [];
      const csvText = await dlRes.text();

      return GoogleMapsScraperService.parseDockerCsv(csvText, category, city);
    } catch (err) {
      notes.push(`Docker scraper error: ${err instanceof Error ? err.message : "unknown"}`);
      return [];
    }
  }

  private static parseDockerCsv(csv: string, category: string, city: string): ScrapedGoogleLead[] {
    const lines = csv.split("\n");
    if (lines.length < 2) return [];

    const headers = GoogleMapsScraperService.parseCsvLine(lines[0]);
    const col = (name: string) => headers.indexOf(name);

    const leads: ScrapedGoogleLead[] = [];
    for (let i = 1; i < lines.length; i++) {
      if (!lines[i].trim()) continue;
      const vals = GoogleMapsScraperService.parseCsvLine(lines[i]);
      const get = (name: string) => { const idx = col(name); return idx >= 0 ? vals[idx]?.trim() || null : null; };
      const getNum = (name: string) => { const v = get(name); return v ? parseFloat(v) || null : null; };

      const title = get("title");
      if (!title) continue;

      const website = get("website");
      const phone = get("phone");
      const emails = get("emails");
      const rating = getNum("review_rating");
      const reviewCount = getNum("review_count") ? Math.round(getNum("review_count")!) : null;
      const address = get("address") || get("complete_address");
      const lat = getNum("latitude");
      const lng = getNum("longitude");
      const placeId = get("place_id") || get("cid") || `gmaps_${i}`;

      const priority = GoogleMapsScraperService.tierGoogle(website, rating, reviewCount);
      const priorityReason = GoogleMapsScraperService.explainTierGoogle(priority, website, rating, reviewCount, phone, emails);
      const fitScore = GoogleMapsScraperService.scoreGoogle(priority, rating, reviewCount, phone, website, emails);

      leads.push({
        companyName: title,
        website,
        industry: get("category") || category,
        location: address,
        phone,
        rating,
        reviewCount,
        openingHours: get("open_hours"),
        lat,
        lng,
        placeId: placeId!,
        googleMapsUrl: get("link") || (lat && lng ? `https://www.google.com/maps/search/?api=1&query=${lat},${lng}` : null),
        priceLevel: get("price_range"),
        priority,
        priorityReason,
        suggestedHook: null,
        sourceQuery: `${category} in ${city}`,
        sourceUrl: get("link") || "Google Maps",
        fitScore,
        businessStatus: get("status"),
        types: get("category") ? [get("category")!] : [],
      });
    }
    return leads;
  }

  private static parseCsvLine(line: string): string[] {
    const result: string[] = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuotes) {
        if (ch === '"' && line[i + 1] === '"') { current += '"'; i++; }
        else if (ch === '"') { inQuotes = false; }
        else { current += ch; }
      } else {
        if (ch === '"') { inQuotes = true; }
        else if (ch === ",") { result.push(current); current = ""; }
        else { current += ch; }
      }
    }
    result.push(current);
    return result;
  }

  private static tierGoogle(website: string | null, rating: number | null, reviewCount: number | null): ScrapedPriority {
    const hasWebsite = Boolean(website);
    const lowReviews = !reviewCount || reviewCount < 20;
    if (!hasWebsite && lowReviews) return "Hot";
    if (!hasWebsite || lowReviews) return "Warm";
    return "Cold";
  }

  private static explainTierGoogle(
    priority: ScrapedPriority, website: string | null, rating: number | null,
    reviewCount: number | null, phone: string | null, emails: string | null
  ): string {
    if (priority === "Hot") {
      const parts: string[] = [];
      if (!website) parts.push("no website");
      if (!reviewCount || reviewCount < 20) parts.push(`${reviewCount ?? 0} reviews`);
      if (!emails) parts.push("no email found");
      return parts.join(", ") + " — high potential for digital services";
    }
    if (priority === "Warm") {
      if (!website) return `no website, ${reviewCount ?? 0} reviews — needs online presence`;
      return `${rating?.toFixed(1) ?? "?"} stars, ${reviewCount ?? 0} reviews — could improve visibility`;
    }
    return `has website, ${rating?.toFixed(1) ?? "?"} stars with ${reviewCount ?? 0} reviews`;
  }

  private static scoreGoogle(
    priority: ScrapedPriority, rating: number | null, reviewCount: number | null,
    phone: string | null, website: string | null, emails: string | null
  ): number {
    let s = priority === "Hot" ? 80 : priority === "Warm" ? 55 : 25;
    if (!website) s += 8;
    if (phone) s += 3;
    if (emails) s += 3;
    if (rating && rating >= 4.0) s += 3;
    if (reviewCount && reviewCount >= 10 && reviewCount < 50) s += 4;
    return Math.max(0, Math.min(s, 98));
  }

  // --- Nominatim POI search ---

  private static async nominatimSearch(category: string, city: string, notes: string[]): Promise<RawPOI[]> {
    await nominatimGate();
    try {
      const q = `${category} in ${city}`;
      const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=30&addressdetails=1&extratags=1`;
      const res = await fetch(url, {
        headers: { "User-Agent": USER_AGENT, "Accept-Language": "en" },
        signal: AbortSignal.timeout(NOMINATIM_TIMEOUT),
      });
      if (!res.ok) {
        notes.push(`Nominatim HTTP ${res.status}`);
        return [];
      }
      const data = (await res.json()) as NominatimPOI[];
      const pois = data
        .filter((d) => d.class !== "boundary" && d.class !== "place" && d.name)
        .filter((d) => GoogleMapsScraperService.isRelevant(d.type, d.name, category));
      if (pois.length > 0) notes.push(`Nominatim found ${pois.length} POIs.`);
      return pois.map((d) => GoogleMapsScraperService.fromNominatim(d));
    } catch (err) {
      notes.push(`Nominatim: ${err instanceof Error ? err.message : "network error"}`);
      return [];
    }
  }

  private static fromNominatim(d: NominatimPOI): RawPOI {
    const addr = d.address ?? {};
    const street = [addr.housenumber, addr.road].filter(Boolean).join(" ").trim();
    const parts = [street || null, addr.suburb, addr.city || addr.town || addr.village, addr.state, addr.postcode].filter(Boolean);
    return {
      osmKey: `${d.osm_type}/${d.osm_id}`,
      name: d.name,
      address: parts.length > 0 ? parts.join(", ") : (d.display_name ?? null),
      lat: parseFloat(d.lat) || null,
      lng: parseFloat(d.lon) || null,
      phone: d.extratags?.phone ?? d.extratags?.["contact:phone"] ?? null,
      website: d.extratags?.website ?? d.extratags?.["contact:website"] ?? null,
      openingHours: d.extratags?.opening_hours ?? null,
      osmClass: d.class,
      osmType: d.type,
    };
  }

  // --- Photon search ---

  private static async photonSearch(category: string, city: string, notes: string[]): Promise<RawPOI[]> {
    try {
      // First geocode the city to get coordinates for location bias
      const center = await GoogleMapsScraperService.geocodeCity(city);
      const q = `${category} ${city}`;
      let url = `https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=20&lang=en`;
      if (center) url += `&lat=${center.lat}&lon=${center.lon}`;

      const res = await fetch(url, {
        headers: { "User-Agent": USER_AGENT },
        signal: AbortSignal.timeout(FETCH_TIMEOUT),
      });
      if (!res.ok) {
        notes.push(`Photon HTTP ${res.status}`);
        return [];
      }
      const data = (await res.json()) as { features?: PhotonFeature[] };
      const cityKey = city.toLowerCase().split(",")[0].trim();
      const features = (data.features ?? []).filter((f) => {
        const p = f.properties;
        if (!p?.name) return false;
        const isBusiness = ["leisure", "amenity", "shop", "tourism", "healthcare", "sport"].includes(p.osm_key ?? "");
        if (!isBusiness) return false;
        if (!GoogleMapsScraperService.isRelevant(p.osm_value ?? "", p.name, category)) return false;
        const fields = [p.city, p.state, p.country].filter(Boolean).join(" ").toLowerCase();
        if (fields.includes(cityKey)) return true;
        if (center) {
          const coords = f.geometry?.coordinates;
          if (coords && coords.length >= 2) {
            const dist = Math.abs(coords[1] - center.lat) + Math.abs(coords[0] - center.lon);
            if (dist < 0.5) return true;
          }
        }
        return false;
      });
      if (features.length > 0) notes.push(`Photon found ${features.length} POIs.`);
      return features.map((f) => GoogleMapsScraperService.fromPhoton(f));
    } catch (err) {
      notes.push(`Photon: ${err instanceof Error ? err.message : "network error"}`);
      return [];
    }
  }

  private static async geocodeCity(city: string): Promise<{ lat: number; lon: number } | null> {
    try {
      const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(city)}&limit=1&lang=en`;
      const res = await fetch(url, {
        headers: { "User-Agent": USER_AGENT },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) return null;
      const data = (await res.json()) as { features?: PhotonFeature[] };
      const coords = data.features?.[0]?.geometry?.coordinates;
      if (coords && coords.length >= 2) return { lat: coords[1], lon: coords[0] };
      return null;
    } catch {
      return null;
    }
  }

  private static fromPhoton(f: PhotonFeature): RawPOI {
    const p = f.properties ?? {};
    const coords = f.geometry?.coordinates;
    const parts = [p.street ? [p.housenumber, p.street].filter(Boolean).join(" ") : null, p.city, p.state, p.postcode].filter(Boolean);
    const osmType = p.osm_type === "N" ? "node" : p.osm_type === "W" ? "way" : p.osm_type === "R" ? "relation" : "node";
    return {
      osmKey: `${osmType}/${p.osm_id ?? 0}`,
      name: p.name ?? "Unknown",
      address: parts.length > 0 ? parts.join(", ") : null,
      lat: coords?.[1] ?? null,
      lng: coords?.[0] ?? null,
      phone: null,
      website: null,
      openingHours: null,
      osmClass: p.osm_key ?? null,
      osmType: p.osm_value ?? null,
    };
  }

  // --- Category relevance filter ---

  private static isRelevant(osmType: string, name: string, category: string): boolean {
    const catKey = category.toLowerCase().trim();
    const allowedTypes = CATEGORY_RELEVANT_TYPES[catKey];
    if (allowedTypes) {
      return allowedTypes.includes(osmType.toLowerCase());
    }
    // Unknown category: match by name containing the category keyword
    return name.toLowerCase().includes(catKey);
  }

  // --- Convert to lead ---

  private static toLead(raw: RawPOI, category: string, city: string): ScrapedGoogleLead | null {
    if (!raw.name || raw.name.length < 2) return null;

    const website = raw.website?.trim() || null;
    const phone = raw.phone?.trim() || null;
    const priority = GoogleMapsScraperService.tier(website, phone);
    const priorityReason = GoogleMapsScraperService.explainTier(priority, website, phone, raw.openingHours);

    return {
      companyName: raw.name,
      website,
      industry: category,
      location: raw.address,
      phone,
      rating: null,
      reviewCount: null,
      openingHours: raw.openingHours,
      lat: raw.lat,
      lng: raw.lng,
      placeId: raw.osmKey,
      googleMapsUrl: raw.lat && raw.lng
        ? `https://www.openstreetmap.org/${raw.osmKey}`
        : `https://www.google.com/maps/search/${encodeURIComponent(raw.name + " " + city)}`,
      priceLevel: null,
      priority,
      priorityReason,
      suggestedHook: null,
      sourceQuery: `${category} in ${city}`,
      sourceUrl: `https://www.openstreetmap.org/${raw.osmKey}`,
      fitScore: GoogleMapsScraperService.score(priority, phone, raw.openingHours),
      businessStatus: null,
      types: [raw.osmClass, raw.osmType].filter(Boolean) as string[],
    };
  }

  private static tier(website: string | null, phone: string | null): ScrapedPriority {
    if (!website && !phone) return "Hot";
    if (!website) return "Warm";
    return "Cold";
  }

  private static explainTier(
    priority: ScrapedPriority, website: string | null, phone: string | null, hours: string | null
  ): string {
    if (priority === "Hot") return `no website, no phone listed${hours ? " — likely walk-in/word-of-mouth" : ""} — high potential`;
    if (priority === "Warm") return "no website, reachable by phone — needs online presence";
    return "has a listed website";
  }

  private static score(priority: ScrapedPriority, phone: string | null, hours: string | null): number {
    let s = priority === "Hot" ? 80 : priority === "Warm" ? 58 : 25;
    if (phone) s += 5;
    if (hours) s += 4;
    return Math.max(0, Math.min(s, 96));
  }

  private static async suggestHooks(
    leads: ScrapedGoogleLead[], category: string
  ): Promise<Map<string, string> | null> {
    if (leads.length === 0) return null;
    const result = await LlmService.completeJson(
      `You are a B2B outreach specialist. For each local ${category} business, draft ONE short outreach angle (max 140 chars) based on their profile. Focus on what they're missing (no website, no phone) or how they could grow. These are SUGGESTIONS. Respond with JSON: {"places":[{"placeId":"...","hook":"..."}]}`,
      leads
        .map((l) => `${l.placeId} | ${l.companyName} | ${category} | website: ${l.website ?? "none"} | phone: ${l.phone ?? "none"}`)
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

interface RawPOI {
  osmKey: string;
  name: string;
  address: string | null;
  lat: number | null;
  lng: number | null;
  phone: string | null;
  website: string | null;
  openingHours: string | null;
  osmClass: string | null;
  osmType: string | null;
}
