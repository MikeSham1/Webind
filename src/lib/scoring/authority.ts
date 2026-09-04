import type { AuthorityScore, CrawledPage, SignalScore } from "./types";
import { aiGates, capTotal, failedCaps, traditionalGates } from "./gates";
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
  // Caps are page-derived, so composeScore (which only sees signals) leaves
  // them empty; the model wrappers below attach and apply them.
  return { total, signals, coverage, caps: [] };
}

/**
 * Apply the gating checklist to a composed score: the total can't exceed the
 * lowest ceiling among the fundamentals this page failed. See gates.ts.
 */
function withCaps(base: AuthorityScore, caps: AuthorityScore["caps"]): AuthorityScore {
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
  return withCaps(base, failedCaps(aiGates(page)));
}

export function scoreTraditionalAuthority(page: CrawledPage): AuthorityScore {
  const base = composeScore([
    scoreContentQuality(page),
    scoreTechnicalSeo(page),
    scoreTopicalAuthority(page),
    scoreOnPageOptimization(page),
    scoreBacklinks(page),
  ]);
  return withCaps(base, failedCaps(traditionalGates(page)));
}
