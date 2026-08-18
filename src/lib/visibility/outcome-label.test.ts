import { describe, it, expect } from "vitest";
import { realLabelFromReport, MIN_COVERAGE } from "./outcome-label";
import type { VisibilityReport } from "./types";

function report(overrides: Partial<VisibilityReport>): VisibilityReport {
  return {
    domain: "example.com",
    brandName: "Example",
    keywords: [],
    overallScore: 60,
    coverage: 0.8,
    topCompetitors: [],
    recommendations: [],
    enginesUsed: ["claude"],
    ...overrides,
  };
}

describe("realLabelFromReport", () => {
  it("returns the measured score as the label when coverage is sufficient", () => {
    expect(realLabelFromReport(report({ overallScore: 72, coverage: 0.5 }))).toEqual({
      label: 72,
      coverage: 0.5,
    });
  });

  it("drops a run with no definite score (overallScore null)", () => {
    expect(realLabelFromReport(report({ overallScore: null }))).toBeNull();
  });

  it("drops a run whose coverage is below the minimum (too noisy to label)", () => {
    expect(
      realLabelFromReport(report({ overallScore: 50, coverage: MIN_COVERAGE - 0.01 })),
    ).toBeNull();
  });

  it("keeps a run exactly at the coverage floor", () => {
    expect(
      realLabelFromReport(report({ overallScore: 40, coverage: MIN_COVERAGE })),
    ).toEqual({ label: 40, coverage: MIN_COVERAGE });
  });
});
