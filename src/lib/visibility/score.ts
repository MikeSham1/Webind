import type {
  AnswerEngine,
  EngineVisibility,
  KeywordVisibility,
  VisibilityQuery,
  VisibilityReport,
} from "./types";
import { citationRateEstimate } from "./stats";

/**
 * Prominence credited to a "present but unranked" mention — the engine named
 * the brand but gave no signal of how central it was. Deliberately below 100 so
 * a bare mention scores under a clear top recommendation.
 */
const DEFAULT_PRESENT_PROMINENCE = 70;

/** A keyword scoring at or below this is treated as a visibility gap. */
const GAP_THRESHOLD = 50;

/** How many recommendations to surface. */
const MAX_RECOMMENDATIONS = 6;

function clamp(n: number, min = 0, max = 100): number {
  return Math.min(max, Math.max(min, n));
}

/** Normalize a competitor label so "www.Acme.com/" and "acme.com" collapse. */
function normalizeCompetitor(raw: string): string {
  const trimmed = raw.trim().replace(/[.,;]+$/, "");
  try {
    // Parse as a URL when it looks like one; otherwise keep the bare label.
    const url = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    if (/\.[a-z]{2,}(?:[/:?#]|$)/i.test(trimmed)) {
      return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    }
  } catch {
    // fall through to the raw label
  }
  return trimmed.toLowerCase();
}

/**
 * Roll a single keyword's per-engine verdicts into a 0-100 score.
 *
 * Only engines with a definite `present` (true/false) count — the same
 * measured-only rule the authority score uses, so an unconfigured or failed
 * engine never drags the number toward the middle. Returns null when no engine
 * produced a definite verdict for this keyword.
 */
export function scoreKeyword(engines: EngineVisibility[]): number | null {
  let sum = 0;
  let counted = 0;
  for (const e of engines) {
    if (e.present === null) continue;
    counted += 1;
    if (e.present) {
      sum += clamp(e.prominence ?? DEFAULT_PRESENT_PROMINENCE);
    }
    // present === false contributes 0.
  }
  return counted > 0 ? Math.round(sum / counted) : null;
}

/** Attach the rolled-up score to a keyword's engine results. */
export function summarizeKeyword(
  keyword: string,
  engines: EngineVisibility[],
): KeywordVisibility {
  return { keyword, engines, score: scoreKeyword(engines) };
}

/** Distinct competitors across the run, ordered by how often they were cited. */
function rankCompetitors(keywords: KeywordVisibility[]): string[] {
  const counts = new Map<string, number>();
  for (const k of keywords) {
    for (const e of k.engines) {
      for (const raw of e.competitors) {
        const name = normalizeCompetitor(raw);
        if (!name) continue;
        counts.set(name, (counts.get(name) ?? 0) + 1);
      }
    }
  }
  return [...counts.entries()]
    // Most-cited first; break ties alphabetically for determinism.
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([name]) => name);
}

/**
 * Turn the measured gaps into a ranked, plain-English fix list. Pure: derived
 * entirely from the keyword results, so it never invents advice we can't back
 * with a probe.
 */
function buildRecommendations(
  keywords: KeywordVisibility[],
  topCompetitors: string[],
  overallScore: number | null,
): string[] {
  if (overallScore === null) {
    // Missing/unconfigured API keys are an operator problem, not something a
    // customer reading this recommendation can act on — this used to name
    // the exact env var to set, which just told the customer to do our job.
    return [
      "AI visibility scoring isn't available for your account right now. Try again shortly, or contact support if this continues.",
    ];
  }

  const recs: string[] = [];

  // Weakest measured keywords first; unmeasured keywords can't yield advice.
  const gaps = keywords
    .filter((k): k is KeywordVisibility & { score: number } => k.score !== null)
    .filter((k) => k.score <= GAP_THRESHOLD)
    .sort((a, b) => a.score - b.score || a.keyword.localeCompare(b.keyword));

  for (const gap of gaps) {
    const cited = gap.engines
      .flatMap((e) => e.competitors)
      .map(normalizeCompetitor)
      .filter(Boolean);
    const unique = [...new Set(cited)].slice(0, 3);
    const insteadClause = unique.length
      ? ` Engines point to ${unique.join(", ")} instead — publish comparably authoritative, well-sourced content targeting this query.`
      : " Publish authoritative, well-sourced content that directly answers this query.";
    recs.push(`You're barely visible for "${gap.keyword}".${insteadClause}`);
    if (recs.length >= MAX_RECOMMENDATIONS) break;
  }

  if (recs.length < MAX_RECOMMENDATIONS && topCompetitors.length > 0) {
    recs.push(
      `Study who AI engines cite for your topics — ${topCompetitors
        .slice(0, 3)
        .join(", ")} — and earn mentions on the same independent sources.`,
    );
  }

  if (recs.length === 0) {
    recs.push(
      "You're surfacing well across the keywords checked — keep publishing fresh, well-sourced content to hold the position.",
    );
  }

  return recs;
}

/** Assemble the final report from per-keyword results. Pure and deterministic. */
export function buildVisibilityReport(
  query: VisibilityQuery,
  keywords: KeywordVisibility[],
): VisibilityReport {
  const brandName = query.brandName?.trim() || query.domain;

  const scored = keywords.filter(
    (k): k is KeywordVisibility & { score: number } => k.score !== null,
  );
  const overallScore =
    scored.length > 0
      ? Math.round(scored.reduce((s, k) => s + k.score, 0) / scored.length)
      : null;

  let totalCells = 0;
  let definiteCells = 0;
  // Pooled Beta–Binomial counts: every definite probe across the whole run.
  let pooledSamples = 0;
  let pooledHits = 0;
  const enginesSeen = new Set<AnswerEngine>();
  for (const k of keywords) {
    for (const e of k.engines) {
      totalCells += 1;
      if (e.present !== null) {
        definiteCells += 1;
        // Single-probe cells (no `samples` field) count as one definite trial.
        pooledSamples += e.samples ?? 1;
        pooledHits += e.hits ?? (e.present ? 1 : 0);
      }
      if (e.configured) enginesSeen.add(e.engine);
    }
  }
  const coverage = totalCells > 0 ? definiteCells / totalCells : 0;
  const visibilityRate = citationRateEstimate(pooledHits, pooledSamples);

  const topCompetitors = rankCompetitors(keywords);

  return {
    domain: query.domain,
    brandName,
    keywords,
    overallScore,
    coverage,
    topCompetitors,
    recommendations: buildRecommendations(keywords, topCompetitors, overallScore),
    enginesUsed: [...enginesSeen],
    visibilityRate,
  };
}
