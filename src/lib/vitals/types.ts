/**
 * Core Web Vitals — real-user field data from the Chrome UX Report, via the
 * PageSpeed Insights API.
 *
 * These are the only signals in WeBind measured from actual visitors rather
 * than inferred from the page's HTML, so they're kept honest and separate: we
 * expose the underlying p75 values and rate each against Google's published
 * thresholds, rather than folding them into an arbitrary point total. Field
 * data only exists for URLs/origins with enough Chrome traffic, so a new or
 * quiet site legitimately has none — reported as "no field data", never faked.
 */

export type VitalRating = "good" | "needs-improvement" | "poor";

/** One field metric at the 75th percentile, with its threshold rating. */
export interface Vital {
  metric: "LCP" | "INP" | "CLS";
  /** p75 value — milliseconds for LCP/INP, unitless score for CLS. */
  value: number;
  rating: VitalRating;
}

export interface FieldVitals {
  url: string;
  /** "page" = URL-level CrUX data; "origin" = whole-site fallback. */
  source: "page" | "origin";
  /** Worst rating across the measured metrics — the page passes only if all do. */
  overall: VitalRating;
  metrics: Vital[];
}

export type VitalsResult =
  | { ok: true; vitals: FieldVitals }
  | {
      ok: false;
      reason: "not-configured" | "no-field-data" | "error";
      message: string;
    };
