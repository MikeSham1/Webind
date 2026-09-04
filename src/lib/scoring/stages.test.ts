import { describe, it, expect } from "vitest";
import { computeStages } from "./stages";
import type { ReportResult, SignalScore } from "./types";

function sig(key: string, score: number | null, weight: number): SignalScore {
  return { key, label: key, score, weight, reason: "", fix: null };
}

function report(ai: SignalScore[], traditional: SignalScore[]): ReportResult {
  return {
    url: "https://example.com/",
    ai: { total: 0, signals: ai, coverage: 1, caps: [] },
    traditional: { total: 0, signals: traditional, coverage: 1, caps: [] },
    prioritizedFixes: [],
    modelVersion: "test",
  };
}

describe("computeStages", () => {
  it("produces all five stages in pipeline order", () => {
    const stages = computeStages(report([], []));
    expect(stages.map((s) => s.key)).toEqual([
      "searchEligibility",
      "retrievalRelevance",
      "evidenceCitation",
      "authorityTrust",
      "userValue",
    ]);
  });

  it("weights a stage's signals and reports full confidence when all measured", () => {
    const stages = computeStages(
      report(
        [sig("aiCrawlability", 80, 0.12)],
        [sig("technicalSeo", 60, 0.22)],
      ),
    );
    const search = stages.find((s) => s.key === "searchEligibility")!;
    // Weighted mean: (80*0.12 + 60*0.22) / (0.12+0.22) = 67.06 → 67
    expect(search.score).toBe(67);
    expect(search.confidence).toBe(1);
  });

  it("drops the confidence when a stage's signals are unmeasured (off-page)", () => {
    // Authority = eeat (measured) + backlinks + brandMentions (both null).
    const stages = computeStages(
      report(
        [sig("eeat", 90, 0.2), sig("brandMentions", null, 0.08)],
        [sig("backlinks", null, 0.22)],
      ),
    );
    const authority = stages.find((s) => s.key === "authorityTrust")!;
    // Only eeat is measured, so the score reflects it...
    expect(authority.score).toBe(90);
    // ...but confidence is honest: 0.2 / (0.2 + 0.08 + 0.22) = 0.4.
    expect(authority.confidence).toBeCloseTo(0.4);
  });

  it("returns a null score and zero confidence when nothing in the stage measured", () => {
    const stages = computeStages(
      report([sig("brandMentions", null, 0.08)], [sig("backlinks", null, 0.22)]),
    );
    const authority = stages.find((s) => s.key === "authorityTrust")!;
    expect(authority.score).toBeNull();
    expect(authority.confidence).toBe(0);
  });
});
