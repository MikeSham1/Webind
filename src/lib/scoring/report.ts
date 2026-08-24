import type { CrawledPage, ReportResult, SignalScore } from "./types";
import { scoreAiAuthority, scoreTraditionalAuthority } from "./authority";
import { SCORING_MODEL_VERSION } from "./weights";

/**
 * Per-fix economics used to rank recommendations by expected value, not just
 * by how big the deficiency is. `weight × deficiency` alone floats any
 * high-weight gap to the top regardless of how hard or risky the fix is — so a
 * cheap, safe, high-impact fix could sit below an expensive, regression-prone
 * one of equal weight.
 *
 * These are REASONED heuristic estimates (0..1 applicability; effort/risk as
 * multipliers ≥ 1 that discount priority), documented so they can later be
 * REPLACED by expected-uplift learned from WeBind's own applied-fix outcomes
 * (the visibility-outcome / applied-fix loop). `applicability` = how universally
 * the fix helps; `effort` = implementation cost; `risk` = chance of a
 * regression or unintended change.
 */
interface FixEconomics {
  effort: number;
  risk: number;
  applicability: number;
}

const DEFAULT_ECONOMICS: FixEconomics = { effort: 2, risk: 1, applicability: 1 };

const FIX_ECONOMICS: Record<string, FixEconomics> = {
  // Cheap, safe, high-leverage — a robots/canonical/meta edit or a JSON-LD block.
  aiCrawlability: { effort: 1.4, risk: 1, applicability: 1 },
  technicalSeo: { effort: 1, risk: 1, applicability: 1 },
  onPageOptimization: { effort: 1, risk: 1, applicability: 1 },
  schema: { effort: 1.2, risk: 1, applicability: 1 },
  freshness: { effort: 1.5, risk: 1, applicability: 0.8 },
  // Trust/evidence edits — moderate effort, some content risk.
  eeat: { effort: 2, risk: 1.1, applicability: 1 },
  factDensity: { effort: 2.5, risk: 1.2, applicability: 0.9 },
  // Structural/content rewrites — most effort, highest regression risk.
  answerability: { effort: 2.2, risk: 1.2, applicability: 0.95 },
  topicalAuthority: { effort: 2.6, risk: 1.1, applicability: 0.85 },
  contentQuality: { effort: 3, risk: 1.3, applicability: 0.9 },
};

/**
 * Ranking priority ≈ expected uplift × applicability ÷ (effort × risk).
 * Expected uplift is the weighted recoverable gap (`weight × (100 − score)`);
 * the economics then favor cheaper, safer, more broadly-applicable fixes.
 * Unmeasured signals rank last (they carry no fix and are filtered out before
 * this anyway).
 */
export function fixPriority(s: SignalScore): number {
  if (s.score === null) return -1;
  const expectedUplift = s.weight * (100 - s.score);
  const e = FIX_ECONOMICS[s.key] ?? DEFAULT_ECONOMICS;
  return (expectedUplift * e.applicability) / (e.effort * e.risk);
}

export function buildReport(page: CrawledPage): ReportResult {
  const ai = scoreAiAuthority(page);
  const traditional = scoreTraditionalAuthority(page);

  const prioritizedFixes = [...ai.signals, ...traditional.signals]
    .filter((s): s is SignalScore & { fix: string } => s.fix !== null)
    // Rank by priority; break ties by key so ordering is deterministic by
    // design rather than by array insertion order.
    .sort((a, b) => fixPriority(b) - fixPriority(a) || a.key.localeCompare(b.key))
    .map((s) => s.fix);

  return { url: page.url, ai, traditional, prioritizedFixes, modelVersion: SCORING_MODEL_VERSION };
}
