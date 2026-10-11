import { LlmService } from "./llm.service";

/**
 * Lead enrichment — scrapes a company website to extract emails, social links,
 * team/decision-maker info, and tech stack signals. No paid APIs required.
 *
 * Pipeline: fetch homepage → extract emails + socials → find team/about/contact
 * pages → crawl sub-pages → LLM extract structured people → return enrichment.
 */

const FETCH_TIMEOUT = 12_000;
const MAX_HTML_LENGTH = 200_000;
const MAX_SUB_PAGES = 3;

const EMAIL_RE = /\b[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}\b/g;
const SOCIAL_RE: Record<string, RegExp> = {
  linkedin: /https?:\/\/(?:www\.)?linkedin\.com\/(?:company|in)\/[^\s"'<>)]+/gi,
  twitter: /https?:\/\/(?:www\.)?(?:twitter|x)\.com\/[^\s"'<>)]+/gi,
  facebook: /https?:\/\/(?:www\.)?facebook\.com\/[^\s"'<>)]+/gi,
  instagram: /https?:\/\/(?:www\.)?instagram\.com\/[^\s"'<>)]+/gi,
};
const TEAM_PAGE_RE = /\b(about|team|our-team|people|leadership|management|staff|contact|who-we-are)\b/i;

const JUNK_EMAILS = new Set([
  "noreply", "no-reply", "support", "info", "hello", "admin", "webmaster",
  "contact", "sales", "marketing", "help", "service", "billing", "abuse",
]);

export interface EnrichmentResult {
  success: boolean;
  website: string | null;
  emails: EnrichedEmail[];
  socials: Record<string, string>;
  people: EnrichedPerson[];
  techSignals: string[];
  companyDescription: string | null;
  employeeEstimate: string | null;
  notes: string[];
  llmUsed: boolean;
}

export interface EnrichedEmail {
  address: string;
  source: string;
  isPersonal: boolean;
}

export interface EnrichedPerson {
  name: string;
  role: string | null;
  email: string | null;
  linkedinUrl: string | null;
  confidence: "high" | "medium" | "low";
}

export class LeadEnrichmentService {
  static async enrich(params: {
    companyName: string;
    website: string | null;
    location?: string | null;
    industry?: string | null;
  }): Promise<EnrichmentResult> {
    const notes: string[] = [];
    const allEmails = new Map<string, EnrichedEmail>();
    const socials: Record<string, string> = {};
    let people: EnrichedPerson[] = [];
    let techSignals: string[] = [];
    let companyDescription: string | null = null;
    let employeeEstimate: string | null = null;
    let llmUsed = false;

    const website = params.website?.trim() || null;
    if (!website) {
      notes.push("No website available — enrichment limited to company name only.");
      if (LlmService.getStatus().available) {
        const llmResult = await LeadEnrichmentService.llmEnrichNoSite(params.companyName, params.location, params.industry);
        if (llmResult) {
          llmUsed = true;
          people = llmResult.people;
          companyDescription = llmResult.description;
          notes.push("AI-generated insights (unverified — based on general knowledge).");
        }
      }
      return { success: true, website: null, emails: [], socials, people, techSignals, companyDescription, employeeEstimate, notes, llmUsed };
    }

    const baseUrl = website.startsWith("http") ? website : `https://${website}`;
    const homeHtml = await LeadEnrichmentService.fetchPage(baseUrl, notes);
    if (!homeHtml) {
      notes.push("Could not fetch website — the site may be down or blocking automated access.");
      return { success: false, website, emails: [], socials, people, techSignals, companyDescription, employeeEstimate, notes, llmUsed };
    }
    notes.push(`Fetched homepage (${(homeHtml.length / 1024).toFixed(0)} KB).`);

    LeadEnrichmentService.extractEmails(homeHtml, "homepage", allEmails);
    LeadEnrichmentService.extractSocials(homeHtml, socials);
    techSignals = LeadEnrichmentService.detectTech(homeHtml);

    const subPageUrls = LeadEnrichmentService.findTeamPages(homeHtml, baseUrl);
    if (subPageUrls.length > 0) {
      notes.push(`Found ${subPageUrls.length} team/about/contact page(s).`);
      for (const subUrl of subPageUrls.slice(0, MAX_SUB_PAGES)) {
        const subHtml = await LeadEnrichmentService.fetchPage(subUrl, notes);
        if (subHtml) {
          LeadEnrichmentService.extractEmails(subHtml, subUrl, allEmails);
          LeadEnrichmentService.extractSocials(subHtml, socials);
        }
      }
    }

    const emails = Array.from(allEmails.values());
    const personalEmails = emails.filter((e) => e.isPersonal);
    notes.push(`Found ${emails.length} email(s) (${personalEmails.length} personal).`);

    if (LlmService.getStatus().available) {
      const textContent = LeadEnrichmentService.extractVisibleText(homeHtml).slice(0, 4000);
      const llmResult = await LeadEnrichmentService.llmExtractPeople(
        params.companyName, textContent, emails, socials, params.industry
      );
      if (llmResult) {
        llmUsed = true;
        people = llmResult.people;
        companyDescription = llmResult.description;
        employeeEstimate = llmResult.employeeEstimate;
        notes.push("AI extracted team and company details from website content.");
      }
    }

    return {
      success: true, website, emails, socials, people,
      techSignals, companyDescription, employeeEstimate, notes, llmUsed,
    };
  }

  private static async fetchPage(url: string, notes: string[]): Promise<string | null> {
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; AexylCRM/1.0; +https://aexyl.com)",
          "Accept": "text/html,application/xhtml+xml",
          "Accept-Language": "en-US,en;q=0.9",
        },
        redirect: "follow",
        signal: AbortSignal.timeout(FETCH_TIMEOUT),
      });
      if (!res.ok) {
        notes.push(`HTTP ${res.status} fetching ${new URL(url).pathname}.`);
        return null;
      }
      const ct = res.headers.get("content-type") ?? "";
      if (!ct.includes("text/html") && !ct.includes("text/plain") && !ct.includes("application/xhtml")) {
        return null;
      }
      const text = await res.text();
      return text.slice(0, MAX_HTML_LENGTH);
    } catch (err) {
      notes.push(`Fetch error: ${err instanceof Error ? err.message : "network error"}`);
      return null;
    }
  }

  private static extractEmails(
    html: string,
    source: string,
    into: Map<string, EnrichedEmail>
  ) {
    const matches = html.match(EMAIL_RE) ?? [];
    for (const raw of matches) {
      const addr = raw.toLowerCase().trim();
      if (into.has(addr)) continue;
      if (addr.endsWith(".png") || addr.endsWith(".jpg") || addr.endsWith(".gif")) continue;
      if (addr.includes("example.com") || addr.includes("sentry.io") || addr.includes("wixpress.com")) continue;
      const local = addr.split("@")[0];
      const isPersonal = !JUNK_EMAILS.has(local) && !/^\d+$/.test(local);
      into.set(addr, { address: addr, source, isPersonal });
    }
  }

  private static extractSocials(html: string, into: Record<string, string>) {
    for (const [platform, re] of Object.entries(SOCIAL_RE)) {
      if (into[platform]) continue;
      const match = html.match(re);
      if (match?.[0]) {
        const url = match[0].replace(/[)"']+$/, "");
        if (!url.includes("/share") && !url.includes("/intent")) {
          into[platform] = url;
        }
      }
    }
  }

  private static findTeamPages(html: string, baseUrl: string): string[] {
    const hrefRe = /href=["']([^"']+)["']/gi;
    const found: string[] = [];
    const seen = new Set<string>();
    let match: RegExpExecArray | null;
    while ((match = hrefRe.exec(html)) !== null) {
      const href = match[1];
      if (!TEAM_PAGE_RE.test(href)) continue;
      try {
        const full = new URL(href, baseUrl).href;
        if (seen.has(full)) continue;
        const u = new URL(full);
        const base = new URL(baseUrl);
        if (u.hostname !== base.hostname) continue;
        seen.add(full);
        found.push(full);
      } catch { /* invalid URL */ }
    }
    return found;
  }

  private static detectTech(html: string): string[] {
    const signals: string[] = [];
    const lower = html.toLowerCase();
    if (lower.includes("shopify") || lower.includes("myshopify.com")) signals.push("Shopify");
    if (lower.includes("wordpress") || lower.includes("wp-content")) signals.push("WordPress");
    if (lower.includes("wix.com") || lower.includes("wixsite.com")) signals.push("Wix");
    if (lower.includes("squarespace")) signals.push("Squarespace");
    if (lower.includes("webflow")) signals.push("Webflow");
    if (lower.includes("react") || lower.includes("__next")) signals.push("React/Next.js");
    if (lower.includes("google-analytics") || lower.includes("gtag")) signals.push("Google Analytics");
    if (lower.includes("hubspot")) signals.push("HubSpot");
    if (lower.includes("intercom")) signals.push("Intercom");
    if (lower.includes("crisp") || lower.includes("tawk.to") || lower.includes("zendesk")) signals.push("Live Chat");
    if (lower.includes("stripe")) signals.push("Stripe");
    if (lower.includes("razorpay")) signals.push("Razorpay");
    return signals;
  }

  private static extractVisibleText(html: string): string {
    return html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/\s+/g, " ")
      .trim();
  }

  private static async llmExtractPeople(
    companyName: string,
    pageText: string,
    emails: EnrichedEmail[],
    socials: Record<string, string>,
    industry?: string | null,
  ): Promise<{ people: EnrichedPerson[]; description: string | null; employeeEstimate: string | null } | null> {
    const emailList = emails.map((e) => e.address).join(", ");
    const socialList = Object.entries(socials).map(([k, v]) => `${k}: ${v}`).join(", ");
    const result = await LlmService.completeJson(
      `You are a B2B lead enrichment analyst. From the website text of "${companyName}" (${industry ?? "unknown industry"}), extract:
1. Key people (founders, CEO, CTO, marketing heads, decision makers) with their name, role, email (if visible), LinkedIn URL (if visible).
2. A one-sentence company description.
3. Estimated employee count range (e.g. "5-15", "50-100").

Available emails: ${emailList || "none found"}
Social links: ${socialList || "none found"}

Respond with JSON: {"people":[{"name":"...","role":"...","email":null,"linkedinUrl":null,"confidence":"high|medium|low"}],"description":"...","employeeEstimate":"..."}
Only include people you can actually identify from the text — never invent names.`,
      pageText
    );
    if (!result.ok || !result.text) return null;
    const parsed = LlmService.parseJsonLoose(result.text);
    if (!parsed || !Array.isArray(parsed.people)) return null;

    const people: EnrichedPerson[] = [];
    for (const p of parsed.people as { name?: string; role?: string; email?: string; linkedinUrl?: string; confidence?: string }[]) {
      if (typeof p.name !== "string" || p.name.length < 2) continue;
      people.push({
        name: p.name.slice(0, 100),
        role: typeof p.role === "string" ? p.role.slice(0, 80) : null,
        email: typeof p.email === "string" && p.email.includes("@") ? p.email.toLowerCase().slice(0, 120) : null,
        linkedinUrl: typeof p.linkedinUrl === "string" && p.linkedinUrl.includes("linkedin") ? p.linkedinUrl.slice(0, 200) : null,
        confidence: (p.confidence === "high" || p.confidence === "medium" || p.confidence === "low") ? p.confidence : "low",
      });
    }

    return {
      people: people.slice(0, 10),
      description: typeof parsed.description === "string" ? parsed.description.slice(0, 300) : null,
      employeeEstimate: typeof parsed.employeeEstimate === "string" ? parsed.employeeEstimate.slice(0, 20) : null,
    };
  }

  private static async llmEnrichNoSite(
    companyName: string,
    location?: string | null,
    industry?: string | null,
  ): Promise<{ people: EnrichedPerson[]; description: string | null } | null> {
    const result = await LlmService.completeJson(
      `You are a B2B research analyst. For the company "${companyName}" ${location ? `in ${location}` : ""} ${industry ? `(${industry})` : ""}, provide what you know:
1. Key decision makers (founder/CEO/leadership) — only names you're confident about.
2. A one-sentence company description.

Respond with JSON: {"people":[{"name":"...","role":"...","email":null,"linkedinUrl":null,"confidence":"low"}],"description":"..."}
Mark confidence as "low" for all — this is general knowledge, not verified. If you're not confident about any people, return an empty array.`,
      `Company: ${companyName}`
    );
    if (!result.ok || !result.text) return null;
    const parsed = LlmService.parseJsonLoose(result.text);
    if (!parsed) return null;

    const people: EnrichedPerson[] = [];
    if (Array.isArray(parsed.people)) {
      for (const p of parsed.people as { name?: string; role?: string; email?: string; linkedinUrl?: string }[]) {
        if (typeof p.name !== "string" || p.name.length < 2) continue;
        people.push({
          name: p.name.slice(0, 100),
          role: typeof p.role === "string" ? p.role.slice(0, 80) : null,
          email: null,
          linkedinUrl: null,
          confidence: "low",
        });
      }
    }

    return {
      people: people.slice(0, 5),
      description: typeof parsed.description === "string" ? parsed.description.slice(0, 300) : null,
    };
  }
}
