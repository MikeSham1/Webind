import type { ReportResult, SignalScore } from "./types";
import type { CitationResult } from "./ai-citations";
import { composeScore, withCaps } from "./authority";

/**
 * Fold a live citation result into a report as a separate, optional layer.
 *
 * Pure: returns a NEW report and never mutates the input. When the citation
 * result carries a real `brandMentionScore`, the `brandMentions` AI signal is
 * replaced with that score (and its reason/fix updated) and `ai.total` is
 * recomposed. This flips brand mentions from unmeasured to measured, so the AI
 * score's `coverage` rises from 0.75 to 1.0 and the total is renormalized over
 * the wider base — that is exactly why the recomposition goes through
 * {@link composeScore} rather than re-deriving the arithmetic here.
 *
 * When the score is null, the original report is returned unchanged.
 */
export function applyCitations(
  report: ReportResult,
  citations: CitationResult,
): ReportResult {
  const { brandMentionScore } = citations;
  if (brandMentionScore === null) return report;

  const configured = citations.engines.filter((e) => e.configured);
  const cited = configured.filter((e) => e.cited === true);
  const engineWord = configured.length === 1 ? "engine" : "engines";

  const signals: SignalScore[] = report.ai.signals.map((s) => {
    if (s.key !== "brandMentions") return s;
    return {
      ...s,
      score: brandMentionScore,
      reason:
        `Live AI-citation check: ${cited.length} of ${configured.length} ` +
        `${engineWord} cite this brand.`,
      fix:
        brandMentionScore >= 100
          ? null
          : "Earn mentions on authoritative, independent sources so AI " +
            "answer engines cite your brand.",
    };
  });

  // The gating caps are page-derived and unaffected by the citation result, so
  // carry the original ones forward and re-apply them to the recomposed total.
  const base = composeScore(signals);
  return { ...report, ai: report.ai.caps ? withCaps(base, report.ai.caps) : base };
}
