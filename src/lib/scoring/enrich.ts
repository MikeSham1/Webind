import type { ReportResult, SignalScore } from "./types";
import type { CitationResult } from "./ai-citations";

/**
 * Fold a live citation result into a report as a separate, optional layer.
 *
 * Pure: returns a NEW report and never mutates the input. When the citation
 * result carries a real `brandMentionScore`, the `brandMentions` AI signal is
 * replaced with that score (and its reason/fix updated) and `ai.total` is
 * recomputed as round(Σ score*weight). When the score is null, the original
 * report is returned unchanged.
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

  // Recompose the AI total from the (possibly updated) per-signal weights.
  const total = Math.round(
    signals.reduce((sum, s) => sum + s.score * s.weight, 0),
  );

  return { ...report, ai: { total, signals } };
}
