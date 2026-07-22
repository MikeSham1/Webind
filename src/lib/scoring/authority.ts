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

function compose(signals: SignalScore[]): AuthorityScore {
  const total = Math.round(
    signals.reduce((sum, s) => sum + s.score * s.weight, 0),
  );
  return { total, signals };
}

export function scoreAiAuthority(page: CrawledPage): AuthorityScore {
  return compose([
    scoreEeat(page),
    scoreBrandMentions(page),
    scoreSchema(page),
    scoreAiCrawlability(page),
    scoreFreshness(page),
  ]);
}

export function scoreTraditionalAuthority(page: CrawledPage): AuthorityScore {
  return compose([
    scoreBacklinks(page),
    scoreTopicalAuthority(page),
    scoreTechnicalSeo(page),
    scoreContentQuality(page),
    scoreEngagement(page),
  ]);
}
