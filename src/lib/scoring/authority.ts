import type { AuthorityScore, CrawledPage, SignalScore } from "./types";
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
  let coverage = 0;
  for (const s of signals) {
    if (s.score === null) continue;
    weighted += s.score * s.weight;
    coverage += s.weight;
  }
  const total = coverage > 0 ? Math.round(weighted / coverage) : 0;
  return { total, signals, coverage };
}

export function scoreAiAuthority(page: CrawledPage): AuthorityScore {
  return composeScore([
    scoreEeat(page),
    scoreAnswerability(page),
    scoreFactDensity(page),
    scoreSchema(page),
    scoreAiCrawlability(page),
    scoreFreshness(page),
    scoreBrandMentions(page),
  ]);
}

export function scoreTraditionalAuthority(page: CrawledPage): AuthorityScore {
  return composeScore([
    scoreContentQuality(page),
    scoreTechnicalSeo(page),
    scoreTopicalAuthority(page),
    scoreOnPageOptimization(page),
    scoreBacklinks(page),
  ]);
}
