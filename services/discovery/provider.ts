/**
 * Discovery provider abstraction + Overpass (OSM) implementation.
 * Multi-query pipeline: runs all query variants for a category/city,
 * deduplicates by OSM ID, and returns a merged pool of raw prospects.
 */

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
const OVERPASS_URLS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];
const USER_AGENT = "Aexyl-CRM/1.0 (local business discovery; contact: operator@aexyl.local)";
const NOMINATIM_MIN_INTERVAL_MS = 1_100;
const OVERPASS_MIN_INTERVAL_MS = 3_000;
const OVERPASS_QL_TIMEOUT_S = 25;
const FETCH_TIMEOUT = 30_000;
const GEOFETCH_TIMEOUT = 12_000;
const OVERPASS_MAX_ELEMENTS = 80;

export type DiscoverySource = "overpass" | "google_places";

export const NO_CONTACT_REASON = "No contact source (phone/email/social) listed";

export interface RawProspect {
  externalId: string;
  source: DiscoverySource;
  businessName: string | null;
  category: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  latitude: number | null;
  longitude: number | null;
  phone: string | null;
  email: string | null;
  socials: string[];
  website: string | null;
  openingHours: string | null;
  sourceUrl: string | null;
  sourceQuery: string;
  matchedTag: string | null;
  rawTags: Record<string, string>;
}

export interface DiscoveryQuery {
  category: string;
  city: string;
  queries?: string[];
}

export interface ProviderResult {
  success: boolean;
  prospects: RawProspect[];
  notes: string[];
  queriesRun: number;
}

export interface BusinessDiscoveryProvider {
  search(query: DiscoveryQuery): Promise<ProviderResult>;
}

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
  yoga: ["leisure=fitness_centre", "sport=yoga"],
};

const DEFAULT_QUERY_VARIANTS: Record<string, string[]> = {
  gym: ["gym", "yoga", "sports fitness"],
  fitness: ["gym", "yoga"],
};

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

const PHONE_TAGS = ["phone", "contact:phone", "mobile", "contact:mobile", "contact:whatsapp", "whatsapp"];
const EMAIL_TAGS = ["email", "contact:email"];
const SOCIAL_TAGS = ["contact:facebook", "facebook", "contact:instagram", "instagram"];

export function extractContacts(tags: Record<string, string>): {
  phone: string | null;
  email: string | null;
  socials: string[];
} {
  const first = (keys: string[]) =>
    keys.map((k) => tags[k]?.split(";")[0]?.trim()).find((v) => v && v.length > 0) ?? null;
  const email = first(EMAIL_TAGS);
  return {
    phone: first(PHONE_TAGS),
    email: email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null,
    socials: [...new Set(SOCIAL_TAGS.map((k) => tags[k]?.trim()).filter((v): v is string => !!v))],
  };
}

export function hasContactSource(c: { phone: string | null; email: string | null; socials: string[] }): boolean {
  return Boolean(c.phone || c.email || c.socials.length > 0);
}

let lastNominatimAt = 0;
async function nominatimGate(): Promise<void> {
  const wait = NOMINATIM_MIN_INTERVAL_MS - (Date.now() - lastNominatimAt);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastNominatimAt = Date.now();
}

let lastOverpassAt = 0;
async function overpassGate(): Promise<void> {
  const wait = OVERPASS_MIN_INTERVAL_MS - (Date.now() - lastOverpassAt);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastOverpassAt = Date.now();
}

export class OverpassDiscoveryProvider implements BusinessDiscoveryProvider {
  async search(query: DiscoveryQuery): Promise<ProviderResult> {
    const { category, city } = query;
    const notes: string[] = [];

    const bbox = await this.geocodeCity(city, notes);
    if (!bbox) {
      notes.push(`Could not geocode "${city}".`);
      return { success: false, prospects: [], notes, queriesRun: 0 };
    }
    notes.push(`Located ${city} via Nominatim.`);

    const queryVariants = query.queries
      ?? DEFAULT_QUERY_VARIANTS[category.toLowerCase().trim()]
      ?? [category];

    const seen = new Set<string>();
    const allProspects: RawProspect[] = [];
    let queriesRun = 0;
    const ranQueries = new Set<string>();

    for (const variant of queryVariants) {
      const tags = this.tagsForCategory(variant);
      const queryKey = tags.length > 0 ? tags.sort().join("|") : `name:${variant}`;
      if (ranQueries.has(queryKey)) continue;
      ranQueries.add(queryKey);

      const elements = await this.overpassQuery(bbox, tags, variant, notes);
      queriesRun++;

      for (const el of elements) {
        const prospect = this.toProspect(el, category, city, variant);
        if (!prospect || seen.has(prospect.externalId)) continue;
        seen.add(prospect.externalId);
        allProspects.push(prospect);
      }
    }

    notes.push(`${queriesRun} queries → ${allProspects.length} unique prospects (deduped by OSM ID).`);
    return {
      success: allProspects.length > 0,
      prospects: allProspects,
      notes,
      queriesRun,
    };
  }

  private async geocodeCity(city: string, notes: string[], attempt = 0): Promise<string | null> {
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
      if (!hit?.boundingbox || hit.boundingbox.length !== 4) return null;
      const [south, north, west, east] = hit.boundingbox;
      return `${south},${west},${north},${east}`;
    } catch (error) {
      if (attempt === 0) {
        await new Promise((r) => setTimeout(r, 2_000));
        return this.geocodeCity(city, notes, 1);
      }
      notes.push(`Geocoding failed: ${error instanceof Error ? error.message : "network error"}`);
      return null;
    }
  }

  private tagsForCategory(category: string): string[] {
    const key = category.toLowerCase().trim();
    for (const [name, tags] of Object.entries(CATEGORY_TAG_MAP)) {
      if (key.includes(name)) return tags;
    }
    return [];
  }

  private async overpassQuery(
    bbox: string,
    tags: string[],
    category: string,
    notes: string[],
  ): Promise<OverpassElement[]> {
    const selectors =
      tags.length > 0
        ? tags.map((t) => `nwr[${t}];`).join("")
        : `nwr["name"~"${category.replace(/[^\p{L}\p{N}\s-]/gu, "").trim()}",i];`;

    const ql = `[out:json][timeout:${OVERPASS_QL_TIMEOUT_S}][bbox:${bbox}];(${selectors});out center tags ${OVERPASS_MAX_ELEMENTS};`;

    await overpassGate();
    const failures: string[] = [];
    const attempts = [...OVERPASS_URLS, ...OVERPASS_URLS];
    for (const [i, endpoint] of attempts.entries()) {
      if (i === OVERPASS_URLS.length) await new Promise((r) => setTimeout(r, 15_000));
      const host = new URL(endpoint).host;
      try {
        const res = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": USER_AGENT },
          body: `data=${encodeURIComponent(ql)}`,
          signal: AbortSignal.timeout(FETCH_TIMEOUT),
        });
        if (!res.ok) {
          failures.push(`${host} HTTP ${res.status}`);
          await new Promise((r) => setTimeout(r, res.status === 429 ? 5_000 : 1_000));
          continue;
        }
        const json = (await res.json()) as { elements?: OverpassElement[] };
        if (failures.length > 0) notes.push(`Overpass fallback used (${host}) after: ${failures.join(", ")}.`);
        return json.elements ?? [];
      } catch (error) {
        failures.push(`${host} ${error instanceof Error ? error.message : "network error"}`);
      }
    }
    notes.push(`Overpass query "${category}" failed on all servers: ${failures.join("; ")}.`);
    return [];
  }

  private toProspect(
    el: OverpassElement,
    category: string,
    city: string,
    queryVariant: string,
  ): RawProspect | null {
    if (!el.type || typeof el.id !== "number") return null;
    const tags = el.tags ?? {};
    const name = tags.name?.trim() || null;
    if (!name) return null;

    const lat = typeof el.lat === "number" ? el.lat : (el.center?.lat ?? null);
    const lng = typeof el.lon === "number" ? el.lon : (el.center?.lon ?? null);

    const street = [tags["addr:housenumber"], tags["addr:street"]].filter(Boolean).join(" ").trim();
    const cityPart = tags["addr:city"]?.trim() || null;
    const postcode = tags["addr:postcode"]?.trim() || null;
    const state = tags["addr:state"]?.trim() || null;
    const addressParts = [street || null, cityPart, state, postcode].filter(Boolean);

    return {
      externalId: `${el.type}/${el.id}`,
      source: "overpass",
      businessName: name,
      category,
      address: addressParts.length > 0 ? addressParts.join(", ") : null,
      city: cityPart || city,
      state: state || null,
      country: tags["addr:country"]?.trim() || "IN",
      latitude: lat,
      longitude: lng,
      ...extractContacts(tags),
      website: tags.website?.trim() || tags["contact:website"]?.trim() || null,
      openingHours: tags.opening_hours?.trim() || null,
      sourceUrl: `https://www.openstreetmap.org/${el.type}/${el.id}`,
      sourceQuery: `${queryVariant} in ${city}`,
      matchedTag: this.findMatchedTag(tags),
      rawTags: tags,
    };
  }

  private findMatchedTag(tags: Record<string, string>): string | null {
    for (const candidates of Object.values(CATEGORY_TAG_MAP)) {
      for (const tag of candidates) {
        const [k, v] = tag.split("=");
        if (tags[k] === v) return tag;
      }
    }
    return null;
  }
}
