import type { FieldVitals, Vital, VitalRating, VitalsResult } from "./types";

/**
 * PageSpeed Insights client for Core Web Vitals field data (CrUX).
 *
 * Optional like every external provider: with no PSI_API_KEY the report simply
 * omits the field-data panel. `fetch` is injectable so tests never hit the
 * network, and nothing is read at module load.
 */

const ENDPOINT = "https://www.googleapis.com/pagespeedonline/v5/runPagespeed";

export function isPsiConfigured(): boolean {
  return Boolean(process.env.PSI_API_KEY);
}

/** Google's published p75 thresholds. */
const THRESHOLDS = {
  LCP: { good: 2500, ni: 4000 }, // ms
  INP: { good: 200, ni: 500 }, // ms
  CLS: { good: 0.1, ni: 0.25 }, // unitless
} as const;

function rate(metric: keyof typeof THRESHOLDS, value: number): VitalRating {
  const t = THRESHOLDS[metric];
  if (value <= t.good) return "good";
  if (value <= t.ni) return "needs-improvement";
  return "poor";
}

/** Worst rating wins — a page passes CWV only when every metric passes. */
function worst(ratings: VitalRating[]): VitalRating {
  if (ratings.includes("poor")) return "poor";
  if (ratings.includes("needs-improvement")) return "needs-improvement";
  return "good";
}

export interface PsiOptions {
  /** "mobile" (default) or "desktop" CrUX dataset. */
  strategy?: "mobile" | "desktop";
  fetchImpl?: typeof fetch;
}

/**
 * Fetch Core Web Vitals field data for a URL. Never throws: a missing key,
 * network error, or a URL with no CrUX coverage each return a typed `ok: false`
 * with a specific reason the UI can explain.
 */
export async function fetchFieldVitals(
  url: string,
  opts: PsiOptions = {},
): Promise<VitalsResult> {
  const key = process.env.PSI_API_KEY;
  if (!key) return { ok: false, reason: "not-configured", message: "PSI_API_KEY isn't set." };

  const params = new URLSearchParams({
    url,
    key,
    strategy: opts.strategy ?? "mobile",
    category: "performance",
  });
  const fetchImpl = opts.fetchImpl ?? fetch;

  try {
    const res = await fetchImpl(`${ENDPOINT}?${params.toString()}`);
    if (!res.ok) {
      return { ok: false, reason: "error", message: `PageSpeed lookup failed (${res.status}).` };
    }
    const data = (await res.json()) as PsiResponse;
    return parseVitals(url, data);
  } catch (err) {
    return {
      ok: false,
      reason: "error",
      message: err instanceof Error ? err.message : "PageSpeed lookup failed.",
    };
  }
}

// --- response parsing -------------------------------------------------------

interface PsiMetric {
  percentile?: number;
}
interface PsiExperience {
  metrics?: Record<string, PsiMetric>;
}
interface PsiResponse {
  loadingExperience?: PsiExperience;
  originLoadingExperience?: PsiExperience;
}

/**
 * Prefer URL-level field data; fall back to origin-level (whole-site) when the
 * specific page lacks enough traffic. `null` when neither has field data.
 */
function parseVitals(url: string, data: PsiResponse): VitalsResult {
  const page = extract(url, "page", data.loadingExperience);
  if (page) return { ok: true, vitals: page };
  const origin = extract(url, "origin", data.originLoadingExperience);
  if (origin) return { ok: true, vitals: origin };
  return {
    ok: false,
    reason: "no-field-data",
    message: "This URL doesn't have enough real-user data in the Chrome UX Report yet.",
  };
}

function extract(
  url: string,
  source: "page" | "origin",
  exp: PsiExperience | undefined,
): FieldVitals | null {
  const m = exp?.metrics;
  if (!m) return null;

  const metrics: Vital[] = [];
  const lcp = m.LARGEST_CONTENTFUL_PAINT_MS?.percentile;
  if (typeof lcp === "number") metrics.push({ metric: "LCP", value: lcp, rating: rate("LCP", lcp) });

  const inp = m.INTERACTION_TO_NEXT_PAINT?.percentile;
  if (typeof inp === "number") metrics.push({ metric: "INP", value: inp, rating: rate("INP", inp) });

  const clsRaw = m.CUMULATIVE_LAYOUT_SHIFT_SCORE?.percentile;
  // CrUX reports CLS ×100 as an integer (e.g. 10 → 0.10).
  if (typeof clsRaw === "number") {
    const cls = clsRaw / 100;
    metrics.push({ metric: "CLS", value: cls, rating: rate("CLS", cls) });
  }

  if (metrics.length === 0) return null;
  return { url, source, overall: worst(metrics.map((v) => v.rating)), metrics };
}
