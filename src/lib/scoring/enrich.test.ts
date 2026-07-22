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

    const expectedTotal = Math.round(
      enriched.ai.signals.reduce((sum, s) => sum + s.score * s.weight, 0),
    );
    expect(enriched.ai.total).toBe(expectedTotal);
    // brandMentions moved 50 -> 80, so the total must have changed.
    expect(enriched.ai.total).not.toBe(baseReport.ai.total);
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
    expect(bm.score).toBe(50);
  });

  it("returns the report unchanged when brandMentionScore is null", () => {
    const result = applyCitations(baseReport, citationResult(null, null));
    expect(result).toEqual(baseReport);
  });
});
