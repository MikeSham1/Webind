import type { Percentile } from "./types";

/**
 * Competitive-percentile statistics.
 *
 * "Where does this page sit among the pages winning this query?" is an
 * empirical-distribution question, so we use the empirical CDF rather than
 * assuming any shape. Two corrections keep a small cohort honest:
 *
 *  - Shrinkage toward 50. With few competitors an extreme percentile (0th or
 *    100th) is mostly noise, so we pull it toward the middle by a reliability
 *    weight n/(n+K). K is an untuned prior-strength constant (no calibration
 *    data yet); it's deliberately conspicuous here so it can be learned later.
 *  - A bootstrap 95% band. Resampling the cohort with replacement shows how
 *    much the percentile itself could move under a different draw of rivals —
 *    a small field yields a wide band, which is the honest signal.
 *
 * Deterministic throughout (seeded RNG), so it's fully unit-testable.
 */

/** Prior strength for shrinkage. Untuned — replace once outcome data exists. */
export const SHRINK_K = 8;

/** Bootstrap resample count. */
const BOOTSTRAP_SAMPLES = 1000;

/** Raw empirical percentile: share of the cohort at or below `value`, 0-100. */
export function empiricalPercentile(value: number, cohort: number[]): number {
  if (cohort.length === 0) return 50;
  const atOrBelow = cohort.filter((c) => c <= value).length;
  return (100 * atOrBelow) / cohort.length;
}

/** Pull a percentile toward 50 by the cohort's reliability weight. */
export function shrinkToward50(percentile: number, n: number, k = SHRINK_K): number {
  const reliability = n / (n + k);
  return reliability * percentile + (1 - reliability) * 50;
}

/** Small, fast, deterministic PRNG (mulberry32) so bootstraps are reproducible. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 50;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))));
  return sorted[idx];
}

/**
 * The target's competitive percentile within `cohort`, shrunk toward 50, with a
 * bootstrap 95% band. Returns null when there are no competitors to rank against.
 */
export function competitivePercentile(
  value: number,
  cohort: number[],
  opts: { k?: number; seed?: number; samples?: number } = {},
): Percentile | null {
  const n = cohort.length;
  if (n === 0) return null;

  const k = opts.k ?? SHRINK_K;
  const point = shrinkToward50(empiricalPercentile(value, cohort), n, k);

  const rand = mulberry32(opts.seed ?? 0x9e3779b9);
  const samples = opts.samples ?? BOOTSTRAP_SAMPLES;
  const draws: number[] = [];
  for (let s = 0; s < samples; s++) {
    const resample: number[] = [];
    for (let i = 0; i < n; i++) resample.push(cohort[Math.floor(rand() * n)]);
    draws.push(shrinkToward50(empiricalPercentile(value, resample), n, k));
  }
  draws.sort((a, b) => a - b);

  return {
    value: Math.round(point),
    lo: Math.round(quantile(draws, 0.025)),
    hi: Math.round(quantile(draws, 0.975)),
    n,
  };
}
