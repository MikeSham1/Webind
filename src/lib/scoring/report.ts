import type { CrawledPage, ReportResult, SignalScore } from "./types";
import { scoreAiAuthority, scoreTraditionalAuthority } from "./authority";
import { SCORING_MODEL_VERSION } from "./weights";
import { classifyPageType } from "./page-type";

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

/** Signal keys whose fix would also lift a failed fundamental's cap. */
export function cappedSignalKeys(report: Pick<ReportResult, "ai" | "traditional">): Set<string> {
  const caps = [...(report.ai.caps ?? []), ...(report.traditional.caps ?? [])];
  return new Set(caps.flatMap((c) => (c.signal ? [c.signal] : [])));
}

/**
 * Comparator ranking deficient signals best-value first. A signal whose fix
 * lifts a cap leads: while a fundamental is failing, improving anything else
 * can't raise the capped total, so nothing else is worth doing first. Then by
 * priority, with ties broken by key so ordering is deterministic by design
 * rather than by array insertion order.
 */
export function compareFixes(capped: Set<string>) {
  return (a: SignalScore, b: SignalScore): number =>
    Number(capped.has(b.key)) - Number(capped.has(a.key)) ||
    fixPriority(b) - fixPriority(a) ||
    a.key.localeCompare(b.key);
}

export function buildReport(page: CrawledPage): ReportResult {
  const ai = scoreAiAuthority(page);
  const traditional = scoreTraditionalAuthority(page);

  const ranked = [...ai.signals, ...traditional.signals]
    .filter((s): s is SignalScore & { fix: string } => s.fix !== null)
    .sort(compareFixes(cappedSignalKeys({ ai, traditional })));

  // A failed fundamental that no signal's fix covers (a non-200 status, a
  // blocked Googlebot) gets its own fix ahead of everything else — lowest
  // ceiling first, and once even when both models fail it.
  const covered = new Set(ranked.map((s) => s.key));
  const seen = new Set<string>();
  const capFixes = [...(ai.caps ?? []), ...(traditional.caps ?? [])]
    .filter((c) => !c.signal || !covered.has(c.signal))
    .sort((a, b) => a.ceiling - b.ceiling)
    .filter((c) => !seen.has(c.id) && seen.add(c.id))
    .map((c) => c.fix);

  const prioritizedFixes = [...capFixes, ...ranked.map((s) => s.fix)];

  return {
    url: page.url,
    ai,
    traditional,
    prioritizedFixes,
    modelVersion: SCORING_MODEL_VERSION,
    pageType: classifyPageType(page),
  };
}
