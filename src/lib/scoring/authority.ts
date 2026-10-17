import type { AppliedCap, AuthorityScore, CrawledPage, SignalScore } from "./types";
import { AI_GATES, TRADITIONAL_GATES, capTotal, failedCaps } from "./gates";
import {
  scoreAiCrawlability,
  scoreAnswerability,
  scoreBacklinks,
  scoreBrandMentions,
  scoreContentQuality,
  scoreEeat,
  scoreFactDensity,
  scoreFreshness,
  scoreOnPageOptimization,
  scoreSchema,
  scoreTechnicalSeo,
  scoreTopicalAuthority,
} from "./signals";

/**
 * Combine signals into a 0-100 score, renormalized over measured weight only.
 *
 * Unmeasured signals (`score === null`) are dropped from BOTH the numerator and
 * the denominator rather than folded in at some neutral value. Dividing by the
 * measured weight keeps the full range available and makes `coverage` an honest
 * statement of how much of the model actually ran.
 */
export function composeScore(signals: SignalScore[]): AuthorityScore {
  let weighted = 0;
  let measuredWeight = 0;
  let totalWeight = 0;
  for (const s of signals) {
    totalWeight += s.weight;
    if (s.score === null) continue;
    weighted += s.score * s.weight;
    measuredWeight += s.weight;
  }
  const total = measuredWeight > 0 ? Math.round(weighted / measuredWeight) : 0;
  // Coverage is the share of THIS page's model that ran. Dividing by the total
  // present weight (not a hard-coded 1.0) keeps it honest when a signal is
  // deliberately down-weighted for a page type — e.g. evidence on a homepage —
  // so coverage still reaches 1.0 once everything is measured.
  const coverage = totalWeight > 0 ? measuredWeight / totalWeight : 0;
  return { total, signals, coverage };
}

/**
 * Apply the gating checklist to a composed score: the total can't exceed the
 * lowest ceiling among the fundamentals this page failed. See gates.ts.
 */
export function withCaps(base: AuthorityScore, caps: AppliedCap[]): AuthorityScore {
  return { ...base, caps, total: capTotal(base.total, caps) };
}

export function scoreAiAuthority(page: CrawledPage): AuthorityScore {
  const base = composeScore([
    scoreEeat(page),
    scoreAnswerability(page),
    scoreFactDensity(page),
    scoreSchema(page),
    scoreAiCrawlability(page),
    scoreFreshness(page),
    scoreBrandMentions(page),
  ]);
  return withCaps(base, failedCaps(AI_GATES, page));
}

export function scoreTraditionalAuthority(page: CrawledPage): AuthorityScore {
  const base = composeScore([
    scoreContentQuality(page),
    scoreTechnicalSeo(page),
    scoreTopicalAuthority(page),
    scoreOnPageOptimization(page),
    scoreBacklinks(page),
  ]);
  return withCaps(base, failedCaps(TRADITIONAL_GATES, page));
}
