/**
 * Signal weights for the on-page readiness estimate.
 *
 * These are reasoned from published GEO/AEO research, corrected for what 2026
 * evidence actually supports — which is less than the GEO hype cycle claimed.
 * Deliberate corrections baked into the signals these weights apply to:
 *   - llms.txt is NOT scored (engines say it neither helps nor hurts).
 *   - FAQPage schema is NOT rewarded or recommended (Google removed FAQ rich
 *     results; no special schema is needed for generative Search). Q&A
 *     *structure* still helps and is scored.
 *   - Content length only flags "too thin to answer" — there is no ideal
 *     length, so more words are not rewarded.
 *   - Title/meta length is a usability nudge (truncation), not a hard rule.
 *   - Freshness decays gently and never to zero, because how much recency
 *     matters is topic-dependent.
 *
 * The weights themselves (which signal counts how much) remain reasoned, not
 * calibrated against labeled citation outcomes — the readiness model and the
 * visibility-outcome training loop are how we move toward real calibration.
 * Brand mentions and backlinks stay off-page unknowns, measured only when a
 * live check / paid index is configured.
 */

/**
 * Bump this whenever a weight, signal, or scoring formula changes, so a
 * stored report can always be traced back to the exact model that produced
 * it. See /methodology for what each version means and the research behind
 * it — and the explicit, honest note that these weights are reasoned from
 * published research, not calibrated against a labeled benchmark dataset (no
 * such dataset — ground-truth "does an AI actually cite this page" labels at
 * scale — exists for us to calibrate against yet).
 */
export const SCORING_MODEL_VERSION = "2026.3";

export const AI_WEIGHTS = {
  eeat: 0.2,
  answerability: 0.18,
  factDensity: 0.16,
  schema: 0.14,
  aiCrawlability: 0.12,
  freshness: 0.12,
  brandMentions: 0.08,
} as const;

export const TRADITIONAL_WEIGHTS = {
  contentQuality: 0.24,
  technicalSeo: 0.22,
  topicalAuthority: 0.18,
  onPageOptimization: 0.14,
  backlinks: 0.22,
} as const;
