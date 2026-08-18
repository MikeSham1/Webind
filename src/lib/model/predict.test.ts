import { describe, it, expect } from "vitest";
import { makePage } from "../scoring/test-fixtures";
import { predictReadiness, MODEL_META, MODEL_VERSION } from "./predict";

describe("predictReadiness (trained model)", () => {
  it("returns an integer score in 0..100", () => {
    const s = predictReadiness(makePage());
    expect(Number.isInteger(s)).toBe(true);
    expect(s).toBeGreaterThanOrEqual(0);
    expect(s).toBeLessThanOrEqual(100);
  });

  it("is deterministic for the same page", () => {
    const page = makePage();
    expect(predictReadiness(page)).toBe(predictReadiness(page));
  });

  it("learned the AI-crawler gate: blocking AI bots collapses the score", () => {
    const open = predictReadiness(makePage());
    const blocked = predictReadiness(makePage({ robotsAllowsAiBots: false }));
    expect(blocked).toBeLessThan(open);
    // The teacher's gate is multiplicative (~0.18x), so the drop is large.
    expect(open - blocked).toBeGreaterThan(20);
  });

  it("learned that a JS-only shell (no server-rendered content) scores lower", () => {
    const rendered = predictReadiness(makePage());
    const shell = predictReadiness(makePage({ hasServerRenderedContent: false }));
    expect(shell).toBeLessThan(rendered);
  });

  it("rates a rich page above a thin, unstructured one", () => {
    const rich = predictReadiness(makePage());
    const thin = predictReadiness(
      makePage({
        wordCount: 60,
        paragraphCount: 1,
        headings: [],
        listCount: 0,
        listItemCount: 0,
        tableCount: 0,
        blockquoteCount: 0,
        jsonLdBlocks: [],
        outboundLinks: [],
        internalLinkCount: 0,
        hasAboutOrContactLink: false,
        hasCanonical: false,
        hasOpenGraph: false,
        metaDescription: null,
        metaAuthor: null,
        lastModified: null,
      }),
    );
    expect(rich).toBeGreaterThan(thin);
  });

  it("exposes honest provenance metadata", () => {
    expect(MODEL_VERSION).toMatch(/^distill-/);
    expect(MODEL_META.provenance).toMatch(/not measured real-world citation/i);
    // The trained model must beat the predict-the-mean baseline it was scored against.
    expect(MODEL_META.testMAE).toBeLessThan(MODEL_META.baselineTestMAE);
  });
});
