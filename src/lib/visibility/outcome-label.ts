import type { VisibilityReport } from "./types";

/**
 * Derive the real training label from a visibility outcome.
 *
 * The label is the measured 0-100 AI-visibility score — genuine "did an AI
 * answer engine actually surface this brand" data, not Claude's opinion. A run
 * is only usable as a training example when it produced a definite score from
 * enough of the probe matrix; otherwise the label would be noise, so we drop it.
 */
export const MIN_COVERAGE = 0.25;

export interface RealLabel {
  /** Measured AI-visibility, 0-100. */
  label: number;
  /** Fraction (0-1) of the probe matrix that returned a definite verdict. */
  coverage: number;
}

export function realLabelFromReport(report: VisibilityReport): RealLabel | null {
  if (report.overallScore === null) return null;
  if (report.coverage < MIN_COVERAGE) return null;
  return { label: report.overallScore, coverage: report.coverage };
}
