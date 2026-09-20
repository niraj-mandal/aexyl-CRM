/**
 * Rate limiter for API routes (spec §1 — API protection).
 *
 * Two interchangeable stores behind one call signature:
 *  - DEFAULT: in-memory sliding window — correct for a single node, zero deps.
 *  - UPSTASH (auto-enabled when UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN
 *    are set): fixed-window INCR/EXPIRE over the REST API — correct across
 *    horizontally scaled instances.
 *
 * The Redis path fails soft to the in-memory limiter: availability beats a
 * strict limit if the cache is briefly unreachable. The function is async now
 * (Redis is a network call); call sites `await` it.
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

function memoryLimit(key: string, limit: number, windowSec: number): RateLimitResult {
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

let upstashDownUntil = 0;

async function upstashLimit(key: string, limit: number, windowSec: number): Promise<RateLimitResult | null> {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;

  // Circuit breaker: after a failure, skip Redis for 30s instead of adding
  // latency to every request.
  if (Date.now() < upstashDownUntil) return null;

  const windowMs = windowSec * 1000;
  const windowKey = `rl:${key}:${Math.floor(Date.now() / windowMs)}`;
  try {
    const res = await fetch(`${url}/pipeline`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify([
        ["INCR", windowKey],
        ["EXPIRE", windowKey, String(windowSec)],
      ]),
      signal: AbortSignal.timeout(1500),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`upstash ${res.status}`);
    const results = (await res.json()) as { result: number }[];
    const count = Number(results[0]?.result ?? 0);
    if (count > limit) {
      return { ok: false, remaining: 0, retryAfterSec: windowSec };
    }
    return { ok: true, remaining: Math.max(0, limit - count), retryAfterSec: 0 };
  } catch {
    upstashDownUntil = Date.now() + 30_000;
    return null; // fall through to memory
  }
}

/**
 * Allow `limit` requests per `windowSec` per key. Returns ok=false with a
 * retry-after hint when exceeded.
 */
export async function rateLimit(key: string, limit: number, windowSec: number): Promise<RateLimitResult> {
  const viaRedis = await upstashLimit(key, limit, windowSec);
  return viaRedis ?? memoryLimit(key, limit, windowSec);
}

/** Best-effort client identity for rate limiting: auth'd user id when available, else IP. */
export function clientKey(request: Request, scope: string, userId?: string): string {
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip") ??
    "unknown";
  return `${scope}:${userId ?? ip}`;
}
