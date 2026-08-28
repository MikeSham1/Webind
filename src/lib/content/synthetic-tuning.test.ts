import { describe, expect, it } from "vitest";
import { buildSyntheticBriefs, splitSyntheticExamples, type SelectedSyntheticExample } from "./synthetic-tuning";

function fakeExample(id: string): SelectedSyntheticExample {
  const brief = buildSyntheticBriefs(1, id)[0];
  brief.id = id;
  return {
    brief,
    winner: {
      markdown: "# Example\n\nUseful copy.",
      quality: {
        score: 80,
        dimensions: { substance: 80, extractability: 80, readability: 80, evidence: 80, intent: 80 },
        warnings: [],
      },
      judge: {
        grounded: true,
        unsupportedClaims: [],
        usefulness: 80,
        intentFit: 80,
        extractability: 80,
        notes: [],
      },
      compositeScore: 80,
      rejected: false,
      rejectionReasons: [],
    },
    row: { systemInstruction: { parts: [{ text: "system" }] }, contents: [] },
    provenance: {
      researchVersion: "test",
      principleIds: [],
      teacherModel: "teacher",
      judgeModel: "judge",
      candidateCount: 4,
    },
  };
}

describe("synthetic tuning corpus", () => {
  it("builds deterministic, diverse fictional briefs", () => {
    const a = buildSyntheticBriefs(30, "same-seed");
    const b = buildSyntheticBriefs(30, "same-seed");
    expect(a).toEqual(b);
    expect(new Set(a.map((x) => x.inputs.pageType)).size).toBe(5);
    expect(new Set(a.map((x) => x.slice.industry)).size).toBeGreaterThan(3);
    expect(a.every((x) => x.inputs.brandName?.startsWith("Northstar "))).toBe(true);
  });

  it("puts every example in exactly one stable split", () => {
    const examples = Array.from({ length: 200 }, (_, i) => fakeExample(`example-${i}`));
    const first = splitSyntheticExamples(examples);
    const second = splitSyntheticExamples(examples);
    const all = [...first.train, ...first.validation, ...first.locked];

    expect(all).toHaveLength(examples.length);
    expect(new Set(all.map((x) => x.brief.id)).size).toBe(examples.length);
    expect(first.train.map((x) => x.brief.id)).toEqual(second.train.map((x) => x.brief.id));
    expect(first.validation.length).toBeGreaterThan(0);
    expect(first.locked.length).toBeGreaterThan(0);
  });
});
