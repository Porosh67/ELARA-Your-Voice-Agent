import "server-only";

/**
 * Simple in-memory sliding-window rate limiter, keyed per user.
 *
 * Deliberately process-local: it is exact for a single instance (the current
 * deployment shape) and a best-effort budget cap behind a load balancer. It
 * protects the LLM/STT budget from runaway clients without adding
 * infrastructure.
 *
 * NOT a security boundary. Behind N instances the effective ceiling is up to
 * N x 12 per window, and on serverless the table resets on every cold start.
 * Move to a shared store (Upstash / Supabase) before scaling out. Both call
 * sites return `Retry-After: 60` so a throttled client backs off instead of
 * retrying into the wall.
 */

const WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 12;
const MAX_TRACKED_KEYS = 5_000;

const hits = new Map<string, number[]>();

export function isRateLimited(key: string): boolean {
  const now = Date.now();
  const previous = hits.get(key) ?? [];

  const recent = previous.filter((timestamp) => now - timestamp < WINDOW_MS);

  if (recent.length >= MAX_REQUESTS_PER_WINDOW) {
    hits.set(key, recent);
    return true;
  }

  recent.push(now);

  /*
   * Bound memory: when the table grows past the cap, drop the first-inserted
   * key. Note that `Map.set` on an existing key does NOT reorder it, so this
   * is insertion order rather than true LRU. The goal is a memory bound, not
   * perfect recency accuracy.
   */
  if (hits.size > MAX_TRACKED_KEYS) {
    const oldest = hits.keys().next().value;
    if (oldest !== undefined) {
      hits.delete(oldest);
    }
  }

  hits.set(key, recent);
  return false;
}
