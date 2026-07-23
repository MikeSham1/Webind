import { describe, it, expect } from "vitest";
import type { CrawledPage } from "./types";
import {
  composeScore,
  scoreAiAuthority,
  scoreTraditionalAuthority,
} from "./authority";
import { daysAgo, makePage } from "./test-fixtures";

function optimizedPage(overrides: Partial<CrawledPage> = {}): CrawledPage {
  return makePage({
    metaAuthor: "Jane Doe",
    outboundLinks: [
      "https://en.wikipedia.org/wiki/Widget",
      "https://www.reuters.com/article",
    ],
    jsonLdBlocks: [{ "@type": "Organization" }, { "@type": "WebSite" }],
    lastModified: daysAgo(5),
    // Enough breadth and volume to max out the topical-authority proxy, with
    // exactly one H1 so technical SEO is clean too.
    headings: Array.from({ length: 10 }, (_, i) => ({
      level: i === 0 ? 1 : 2,
      text: `H${i}`,
    })),
    wordCount: 1600,
    ...overrides,
  });
}

/** A page failing every measurable signal. */
function brokenPage(): CrawledPage {
  return makePage({
    statusCode: 500,
    title: null,
    metaDescription: null,
    metaAuthor: null,
    headings: [],
    jsonLdBlocks: [],
    outboundLinks: [],
    renderedText: "thin",
    wordCount: 10,
    hasServerRenderedContent: false,
    robotsAllowsAiBots: false,
    hasLlmsTxt: false,
    lastModified: daysAgo(900),
  });
}

describe("scoreAiAuthority", () => {
  it("returns exactly 5 AI signals", () => {
    const a = scoreAiAuthority(optimizedPage());
    expect(a.signals).toHaveLength(5);
    expect(a.signals.map((s) => s.key).sort()).toEqual(
      ["aiCrawlability", "brandMentions", "eeat", "freshness", "schema"].sort(),
    );
  });

  it("total is within 0..100", () => {
    const a = scoreAiAuthority(optimizedPage());
    expect(a.total).toBeGreaterThanOrEqual(0);
    expect(a.total).toBeLessThanOrEqual(100);
  });

  it("a fully-optimized page scores AI total > 70", () => {
    expect(scoreAiAuthority(optimizedPage()).total).toBeGreaterThan(70);
  });
});

describe("scoreTraditionalAuthority", () => {
  it("returns exactly 5 traditional signals", () => {
    const t = scoreTraditionalAuthority(optimizedPage());
    expect(t.signals).toHaveLength(5);
    expect(t.signals.map((s) => s.key).sort()).toEqual(
      [
        "backlinks",
        "contentQuality",
        "engagement",
        "technicalSeo",
        "topicalAuthority",
      ].sort(),
    );
  });

  it("total is within 0..100", () => {
    const t = scoreTraditionalAuthority(optimizedPage());
    expect(t.total).toBeGreaterThanOrEqual(0);
    expect(t.total).toBeLessThanOrEqual(100);
  });
});

describe("composeScore renormalization", () => {
  it("ignores unmeasured signals in both the total and the coverage", () => {
    const score = composeScore([
      { key: "a", label: "A", score: 80, weight: 0.3, reason: "", fix: null },
      { key: "b", label: "B", score: null, weight: 0.5, reason: "", fix: null },
      { key: "c", label: "C", score: 40, weight: 0.2, reason: "", fix: null },
    ]);
    // (80*0.3 + 40*0.2) / 0.5 = 64 — not 32, which is what folding the
    // unmeasured half in at zero weight-share would have produced.
    expect(score.total).toBe(64);
    expect(score.coverage).toBeCloseTo(0.5);
  });

  it("returns 0 when nothing could be measured", () => {
    const score = composeScore([
      { key: "a", label: "A", score: null, weight: 0.6, reason: "", fix: null },
    ]);
    expect(score.total).toBe(0);
    expect(score.coverage).toBe(0);
  });
});

describe("score range (regression: placeholders used to clamp the range)", () => {
  // Three signals were pinned at a neutral 50 and averaged into the totals,
  // which confined the traditional score to [20, 80] and the AI score to
  // [13, 88]: a flawless site was told it scored 80/100. Renormalizing over
  // measured weight restores the full range.
  it("a page passing every measured signal scores 100 on both", () => {
    const page = optimizedPage();
    expect(scoreAiAuthority(page).total).toBe(100);
    expect(scoreTraditionalAuthority(page).total).toBe(100);
  });

  it("a page failing every measured signal scores near 0 on both", () => {
    const page = brokenPage();
    // Freshness deliberately floors at 40 for an unusable date, and this page
    // has a real (very old) one, so the AI total can reach a true 0.
    expect(scoreAiAuthority(page).total).toBe(0);
    expect(scoreTraditionalAuthority(page).total).toBeLessThan(15);
  });

  it("reports how much of each model actually ran", () => {
    const page = optimizedPage();
    // AI: eeat .30 + schema .15 + crawlability .15 + freshness .15 = .75
    expect(scoreAiAuthority(page).coverage).toBeCloseTo(0.75);
    // Traditional: topical .25 + technical .20 + quality .15 = .60
    expect(scoreTraditionalAuthority(page).coverage).toBeCloseTo(0.6);
  });
});
