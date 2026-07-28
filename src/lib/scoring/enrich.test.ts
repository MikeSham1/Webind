import { describe, it, expect } from "vitest";
import { buildReport } from "./report";
import { makePage } from "./test-fixtures";
import { applyCitations } from "./enrich";
import type { CitationResult } from "./ai-citations";

const baseReport = buildReport(makePage());

function citationResult(
  brandMentionScore: number | null,
  cited: boolean | null,
): CitationResult {
  return {
    configured: brandMentionScore !== null,
    engines: [
      { engine: "claude", configured: true, cited, evidence: "x" },
    ],
    brandMentionScore,
  };
}

describe("applyCitations", () => {
  it("updates the brandMentions signal and recomputes ai.total", () => {
    const enriched = applyCitations(baseReport, citationResult(80, true));

    const bm = enriched.ai.signals.find((s) => s.key === "brandMentions")!;
    expect(bm.score).toBe(80);
    expect(bm.reason).toContain("1 of 1");
    expect(bm.fix).not.toBeNull();

    // Every signal is measured now, so the total is the plain weighted sum.
    const expectedTotal = Math.round(
      enriched.ai.signals.reduce((sum, s) => sum + s.score! * s.weight, 0),
    );
    expect(enriched.ai.total).toBe(expectedTotal);
  });

  it("moves the total toward the measured brand-mention score", () => {
    // A weak citation result pulls the total below the on-page baseline; a
    // strong one lifts it above.
    expect(applyCitations(baseReport, citationResult(0, false)).ai.total).toBeLessThan(
      baseReport.ai.total,
    );
    expect(applyCitations(baseReport, citationResult(100, true)).ai.total).toBeGreaterThan(
      baseReport.ai.total,
    );
  });

  it("widens coverage to the full model once brand mentions are measured", () => {
    // Base report leaves brand mentions (0.08) unmeasured; the citation check
    // supplies it, so the AI score is renormalized over the whole model.
    expect(baseReport.ai.coverage).toBeCloseTo(0.92);
    const enriched = applyCitations(baseReport, citationResult(80, true));
    expect(enriched.ai.coverage).toBeCloseTo(1);
  });

  it("clears the fix when the brand is fully cited", () => {
    const enriched = applyCitations(baseReport, citationResult(100, true));
    const bm = enriched.ai.signals.find((s) => s.key === "brandMentions")!;
    expect(bm.score).toBe(100);
    expect(bm.fix).toBeNull();
  });

  it("is pure — the input report is not mutated", () => {
    applyCitations(baseReport, citationResult(80, true));
    const bm = baseReport.ai.signals.find((s) => s.key === "brandMentions")!;
    expect(bm.score).toBeNull();
  });

  it("returns the report unchanged when brandMentionScore is null", () => {
    const result = applyCitations(baseReport, citationResult(null, null));
    expect(result).toEqual(baseReport);
  });
});
