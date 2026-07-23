import type { AuthorityScore, CrawledPage, SignalScore } from "./types";
import {
  scoreAiCrawlability,
  scoreBacklinks,
  scoreBrandMentions,
  scoreContentQuality,
  scoreEeat,
  scoreEngagement,
  scoreFreshness,
  scoreSchema,
  scoreTechnicalSeo,
  scoreTopicalAuthority,
} from "./signals";

/**
 * Combine signals into a 0-100 score, renormalized over measured weight only.
 *
 * Unmeasured signals (`score === null`) are dropped from BOTH the numerator and
 * the denominator rather than folded in at some neutral value. Averaging a
 * placeholder into the total compresses the result toward that placeholder —
 * with three of the ten signals pinned at 50, the traditional score could only
 * ever land in [20, 80], so a flawless site was told it scored 80/100 and a
 * broken one 20/100. Dividing by the measured weight keeps the full range
 * available and makes `coverage` an honest statement of how much of the model
 * actually ran.
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
    scoreBrandMentions(page),
    scoreSchema(page),
    scoreAiCrawlability(page),
    scoreFreshness(page),
  ]);
}

export function scoreTraditionalAuthority(page: CrawledPage): AuthorityScore {
  return composeScore([
    scoreBacklinks(page),
    scoreTopicalAuthority(page),
    scoreTechnicalSeo(page),
    scoreContentQuality(page),
    scoreEngagement(page),
  ]);
}
