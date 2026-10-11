/**
 * Website status verification with SSRF protection.
 * Classifies each candidate's web presence quality.
 */

export type WebsiteStatus =
  | "NO_WEBSITE"
  | "BROKEN_WEBSITE"
  | "POOR_WEBSITE"
  | "BASIC_WEBSITE"
  | "GOOD_WEBSITE"
  | "UNKNOWN";

export interface WebsiteCheckResult {
  status: WebsiteStatus;
  url: string | null;
  reason: string;
}

const VERIFY_TIMEOUT = 10_000;
const MAX_REDIRECTS = 3;
const MAX_CONCURRENT = 3;
const USER_AGENT = "Aexyl-CRM/1.0 (website verification)";

const PRIVATE_IP_PATTERNS = [
  /^127\./,
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^169\.254\./,
  /^0\./,
  /^::1$/,
  /^fc/i,
  /^fd/i,
  /^fe80/i,
];

function isPrivateHost(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  if (lower === "localhost" || lower.endsWith(".local") || lower.endsWith(".internal")) return true;
  return PRIVATE_IP_PATTERNS.some((p) => p.test(lower));
}

function isSafeUrl(url: string): { safe: boolean; reason?: string } {
  try {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return { safe: false, reason: `Blocked protocol: ${parsed.protocol}` };
    }
    if (isPrivateHost(parsed.hostname)) {
      return { safe: false, reason: "Blocked private/localhost URL" };
    }
    return { safe: true };
  } catch {
    return { safe: false, reason: "Invalid URL" };
  }
}

async function verifyOne(rawUrl: string): Promise<WebsiteCheckResult> {
  const url = rawUrl.startsWith("http") ? rawUrl : `https://${rawUrl}`;
  const safety = isSafeUrl(url);
  if (!safety.safe) {
    return { status: "UNKNOWN", url, reason: safety.reason! };
  }

  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        "User-Agent": USER_AGENT,
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(VERIFY_TIMEOUT),
    });

    if (!res.ok) {
      if (res.status >= 500) return { status: "BROKEN_WEBSITE", url, reason: `Server error ${res.status}` };
      if (res.status === 403 || res.status === 401) return { status: "BASIC_WEBSITE", url, reason: "Access restricted" };
      if (res.status === 404) return { status: "BROKEN_WEBSITE", url, reason: "Page not found" };
      return { status: "BROKEN_WEBSITE", url, reason: `HTTP ${res.status}` };
    }

    const ct = res.headers.get("content-type") ?? "";
    if (!ct.includes("text/html") && !ct.includes("application/xhtml")) {
      return { status: "POOR_WEBSITE", url, reason: "Non-HTML response" };
    }

    const html = await res.text();
    const length = html.length;

    if (length < 500) {
      return { status: "POOR_WEBSITE", url, reason: "Minimal content (under 500 chars)" };
    }

    const lower = html.toLowerCase();
    const hasViewport = lower.includes("viewport");
    const hasTitle = /<title[^>]*>[^<]+<\/title>/i.test(html);
    const hasImages = /<img\s/i.test(html);
    const hasNav = /<nav\b/i.test(html) || lower.includes("navigation");
    const hasSocial = /facebook|instagram|twitter|linkedin/i.test(html);

    let qualityScore = 0;
    if (hasViewport) qualityScore += 2;
    if (hasTitle) qualityScore += 1;
    if (hasImages) qualityScore += 1;
    if (hasNav) qualityScore += 2;
    if (hasSocial) qualityScore += 1;
    if (length > 5000) qualityScore += 1;
    if (length > 20000) qualityScore += 1;

    if (qualityScore >= 5) {
      return { status: "GOOD_WEBSITE", url, reason: `Well-built site (score ${qualityScore}/9)` };
    }
    if (qualityScore >= 3) {
      return { status: "BASIC_WEBSITE", url, reason: `Basic site (score ${qualityScore}/9)` };
    }
    return { status: "POOR_WEBSITE", url, reason: `Minimal site (score ${qualityScore}/9)` };
  } catch (error) {
    const msg = error instanceof Error ? error.message : "network error";
    if (msg.includes("timeout") || msg.includes("abort")) {
      return { status: "BROKEN_WEBSITE", url, reason: "Connection timeout" };
    }
    return { status: "BROKEN_WEBSITE", url, reason: msg };
  }
}

export class WebsiteVerifier {
  static async verify(rawUrl: string | null): Promise<WebsiteCheckResult> {
    if (!rawUrl || rawUrl.trim().length === 0) {
      return { status: "NO_WEBSITE", url: null, reason: "No website listed" };
    }
    return verifyOne(rawUrl.trim());
  }

  static async verifyBatch(
    urls: (string | null)[],
  ): Promise<WebsiteCheckResult[]> {
    const results: WebsiteCheckResult[] = new Array(urls.length);
    const queue = urls.map((url, i) => ({ url, i }));
    let cursor = 0;

    async function worker() {
      while (cursor < queue.length) {
        const idx = cursor++;
        const { url, i } = queue[idx];
        results[i] = await WebsiteVerifier.verify(url);
      }
    }

    const workers = Array.from({ length: MAX_CONCURRENT }, () => worker());
    await Promise.all(workers);
    return results;
  }
}
