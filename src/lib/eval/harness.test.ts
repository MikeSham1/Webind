import { afterEach, describe, it, expect } from "vitest";
import { makePage } from "../scoring/test-fixtures";
import { fakeProvider, setFakeResponse } from "../ai/generator";
import { runCase, summarize, type EvalCase } from "./harness";

function metaCase(): EvalCase {
  return {
    id: "case-1",
    site: "example.com",
    pageType: "generic",
    category: "metadata",
    riskClass: "low",
    page: makePage({ metaDescription: null, title: "Example Title" }),
  };
}

const gemini = () => fakeProvider();

afterEach(() => setFakeResponse("{}"));

describe("eval harness", () => {
  it("scores a grounded candidate as accepted with full evidence coverage", async () => {
    setFakeResponse(
      JSON.stringify({
        candidates: [
          {
            action: "fix",
            target: "<head>",
            after: "A concise summary of the example page for search results.",
            rationale: "Summarizes the page.",
            evidenceSpanIds: ["ev_001"],
            confidence: "high",
          },
        ],
      }),
    );
    const r = await runCase(gemini(), metaCase());
    expect(r.accepted).toBe(1);
    expect(r.evidenceCoverage).toBe(1);
    expect(r.unsupportedClaims).toBe(0);
    expect(r.fallback).toBe(false);
  });

  it("counts an unsupported factual claim and accepts nothing", async () => {
    setFakeResponse(
      JSON.stringify({
        candidates: [
          {
            action: "fix",
            target: "<head>",
            after: "Trusted by 12,000 firms since 2010.",
            rationale: "x",
            evidenceSpanIds: [],
            confidence: "high",
          },
        ],
      }),
    );
    const r = await runCase(gemini(), metaCase());
    expect(r.accepted).toBe(0);
    expect(r.unsupportedClaims).toBe(1);
  });

  it("records a fallback when the provider fails", async () => {
    setFakeResponse(null);
    const r = await runCase(gemini(), metaCase());
    expect(r.fallback).toBe(true);
    expect(r.accepted).toBe(0);
  });

  it("summarizes across cases", () => {
    const s = summarize("fake", [
      {
        caseId: "a",
        category: "metadata",
        provider: "fake",
        model: "fake-1",
        fallback: false,
        noFix: false,
        accepted: 2,
        rejected: 0,
        unsupportedClaims: 0,
        evidenceCoverage: 1,
      },
      {
        caseId: "b",
        category: "metadata",
        provider: "fake",
        model: "fake-1",
        fallback: false,
        noFix: false,
        accepted: 0,
        rejected: 1,
        unsupportedClaims: 1,
        evidenceCoverage: 0,
      },
    ]);
    expect(s.cases).toBe(2);
    expect(s.meanAccepted).toBe(1);
    expect(s.totalUnsupportedClaims).toBe(1);
    expect(s.meanEvidenceCoverage).toBe(0.5);
  });
});
