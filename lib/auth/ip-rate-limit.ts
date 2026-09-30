import "server-only";

/**
 * Per-IP sliding-window rate limiter for the auth routes.
 *
 * SEPARATE from `lib/brain/rate-limit.ts` on purpose: that one is keyed by USER
 * and protects the LLM budget, while this one is keyed by IP and exists before
 * any user exists. Sharing the table would let a burst of brain calls throttle
 * someone's signup, and vice versa.
 *
 * Same honest caveat as its sibling: process-local, resets on a cold start, and
 * N times the limit behind N instances. It is a budget cap, not a security
 * boundary — the real defence on these routes is that they return nothing
 * useful to an attacker and never send mail for an unknown account.
 */
const WINDOW_MS = 60_000;
const MAX_TRACKED_KEYS = 5_000;

const hits = new Map<string, number[]>();

export interface RateLimitOptions {
  windowMs?: number;
  max?: number;
  /** Distinguishes independent budgets on one IP (e.g. "username" vs "reset"). */
  bucket: string;
}

/**
 * Records a hit and reports whether this caller is over budget.
 * Returns `{ limited, remaining, retryAfterSeconds }`.
 */
export function checkIpRateLimit(
  ip: string,
  options: RateLimitOptions
): { limited: boolean; remaining: number; retryAfterSeconds: number } {
  const windowMs = options.windowMs ?? WINDOW_MS;
  const max = options.max ?? 10;
  const key = `${options.bucket}:${ip}`;
  const now = Date.now();

  const previous = hits.get(key) ?? [];
  const recent = previous.filter((timestamp) => now - timestamp < windowMs);

  if (recent.length >= max) {
    hits.set(key, recent);
    const oldest = recent[0] ?? now;
    return {
      limited: true,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil((oldest + windowMs - now) / 1000)),
    };
  }

  recent.push(now);

  // Bound memory: drop the first-inserted key once the table grows past the cap.
  if (hits.size > MAX_TRACKED_KEYS) {
    const oldestKey = hits.keys().next().value;
    if (oldestKey !== undefined) {
      hits.delete(oldestKey);
    }
  }

  hits.set(key, recent);
  return { limited: false, remaining: max - recent.length, retryAfterSeconds: 0 };
}

/**
 * The caller's IP, from the headers a proxy sets.
 *
 * `x-forwarded-for` is a comma-separated chain appended to by each proxy; the
 * FIRST entry is the original client. When no proxy is in front the values are
 * absent, and everything collapses to one shared bucket — which fails safe
 * (stricter), not open.
 */
export function clientIpFromHeaders(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");

  if (forwarded !== null && forwarded.length > 0) {
    const first = forwarded.split(",")[0]?.trim();
    if (first !== undefined && first.length > 0) {
      return first;
    }
  }

  return (
    headers.get("x-real-ip") ??
    headers.get("cf-connecting-ip") ??
    "unknown"
  );
}
