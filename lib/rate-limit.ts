/**
 * Simple sliding-window rate limiter for API routes (spec §1 — API protection).
 *
 * In-memory per-instance limiter: correct for a single-node deployment, which
 * matches the current deployment shape. If we scale horizontally, swap the Map
 * for Redis — the call signature stays the same.
 */

interface Bucket {
  timestamps: number[];
}

const buckets = new Map<string, Bucket>();
let lastSweep = Date.now();

function sweep(now: number) {
  // Occasionally drop stale buckets so the map doesn't grow forever.
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  for (const [key, bucket] of buckets) {
    bucket.timestamps = bucket.timestamps.filter((t) => now - t < 3_600_000);
    if (bucket.timestamps.length === 0) buckets.delete(key);
  }
}

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  retryAfterSec: number;
}

/**
 * Allow `limit` requests per `windowSec` per key. Returns ok=false with a
 * retry-after hint when exceeded.
 */
export function rateLimit(key: string, limit: number, windowSec: number): RateLimitResult {
  const now = Date.now();
  sweep(now);
  const windowMs = windowSec * 1000;
  const bucket = buckets.get(key) ?? { timestamps: [] };
  bucket.timestamps = bucket.timestamps.filter((t) => now - t < windowMs);

  if (bucket.timestamps.length >= limit) {
    const oldest = bucket.timestamps[0];
    buckets.set(key, bucket);
    return {
      ok: false,
      remaining: 0,
      retryAfterSec: Math.max(1, Math.ceil((oldest + windowMs - now) / 1000)),
    };
  }

  bucket.timestamps.push(now);
  buckets.set(key, bucket);
  return { ok: true, remaining: limit - bucket.timestamps.length, retryAfterSec: 0 };
}

/** Best-effort client identity for rate limiting: auth'd user id when available, else IP. */
export function clientKey(request: Request, scope: string, userId?: string): string {
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip") ??
    "unknown";
  return `${scope}:${userId ?? ip}`;
}
