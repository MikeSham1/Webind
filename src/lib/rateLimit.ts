/**
 * In-memory sliding-window rate limiter.
 *
 * This process is the only source of truth for these counts — correct for a
 * single-container deployment (this app's current Railway setup, one
 * replica), but limits reset on restart and are NOT shared across replicas.
 * If this ever scales horizontally, swap the Map below for a shared store
 * (Redis, Upstash) behind the same `checkRateLimit` signature; nothing that
 * calls it needs to change.
 */

interface Bucket {
  /** Hit timestamps (ms) within the current window, oldest first. */
  hits: number[];
}

const buckets = new Map<string, Bucket>();

// Periodic sweep so idle keys (one-off anonymous visitors, mostly) don't
// accumulate in memory forever. Runs opportunistically on calls rather than a
// timer, so it costs nothing when the app is idle.
const SWEEP_INTERVAL_MS = 5 * 60 * 1000;
let lastSweep = Date.now();

function sweep(now: number): void {
  if (now - lastSweep < SWEEP_INTERVAL_MS) return;
  lastSweep = now;
  for (const [key, bucket] of buckets) {
    const newest = bucket.hits[bucket.hits.length - 1];
    // A bucket with nothing in the last hour is very unlikely to be mid-window
    // for anything we configure; safe to drop.
    if (newest === undefined || now - newest > 60 * 60 * 1000) buckets.delete(key);
  }
}

export interface RateLimitResult {
  allowed: boolean;
  /** Milliseconds until the next request would be allowed, when blocked. */
  retryAfterMs: number;
}

/**
 * Record one hit for `key` and report whether it's within `max` hits per
 * `windowMs`. Call once per attempt (including failed ones), so this is a true
 * rate cap rather than a lockout-after-N-failures — the two are different
 * defenses and this module only implements the former.
 */
export function checkRateLimit(key: string, windowMs: number, max: number): RateLimitResult {
  const now = Date.now();
  sweep(now);

  let bucket = buckets.get(key);
  if (!bucket) {
    bucket = { hits: [] };
    buckets.set(key, bucket);
  }

  const cutoff = now - windowMs;
  bucket.hits = bucket.hits.filter((t) => t > cutoff);

  if (bucket.hits.length >= max) {
    const retryAfterMs = Math.max(bucket.hits[0] + windowMs - now, 0);
    return { allowed: false, retryAfterMs };
  }

  bucket.hits.push(now);
  return { allowed: true, retryAfterMs: 0 };
}

/** "Please wait 45 seconds" / "Please wait 3 minutes" — rounded up, never 0. */
export function formatRetryAfter(retryAfterMs: number): string {
  const seconds = Math.max(1, Math.ceil(retryAfterMs / 1000));
  if (seconds < 60) return `Please wait ${seconds} second${seconds === 1 ? "" : "s"} and try again.`;
  const minutes = Math.ceil(seconds / 60);
  return `Please wait ${minutes} minute${minutes === 1 ? "" : "s"} and try again.`;
}

/** Test-only: clear all state between tests. */
export function __resetRateLimits(): void {
  buckets.clear();
}
