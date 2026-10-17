import { describe, it, expect } from "vitest";
import type { CrawledPage } from "./types";
import {
  composeScore,
  scoreAiAuthority,
  scoreTraditionalAuthority,
} from "./authority";
import { daysAgo, makePage } from "./test-fixtures";

/** A page that passes every measurable signal. */
function optimizedPage(overrides: Partial<CrawledPage> = {}): CrawledPage {
  return makePage({
    url: "https://example.com/guide-to-widgets",
    title: "The Complete Guide to Widgets for Small Businesses",
    metaDescription:
      "A data-backed guide to choosing, buying, and maintaining widgets for small businesses, with pricing benchmarks and expert tips.",
    metaAuthor: "Jane Doe",
    outboundLinks: [
      "https://en.wikipedia.org/a",
      "https://www.reuters.com/b",
      "https://www.nih.gov/c",
    ],
    hasAboutOrContactLink: true,
    jsonLdBlocks: [
      { "@type": "Organization" },
      { "@type": "WebSite" },
      { "@type": "Article", author: { name: "Jane Doe" } },
      { "@type": "BreadcrumbList" },
      { "@type": "FAQPage" },
    ],
    lastModified: daysAgo(5),
    headings: [
      { level: 1, text: "Guide to Widgets" },
      { level: 2, text: "What is a widget?" },
      { level: 3, text: "Types" },
      { level: 2, text: "How much do widgets cost?" },
      { level: 3, text: "Pricing tiers" },
      { level: 4, text: "Enterprise" },
      { level: 2, text: "Best practices" },
      { level: 3, text: "Setup" },
      { level: 3, text: "Maintenance" },
      { level: 2, text: "Common mistakes" },
      { level: 3, text: "Troubleshooting" },
      { level: 2, text: "Conclusion" },
    ],
    wordCount: 1600,
    renderedText:
      "This complete guide to widgets for small businesses shows how, by 2024, 65% of 1,200 firms cut costs 30% saving $5,000 over 12 months, up from 45% in 2023 and 38% in 2022 across 3,400 sites; response times fell 22% to 8.5 hours with 90% retention.",
    // Claims cited to sources in place — a best-in-class page under Evidence
    // Integrity, not just numbers stacked in prose.
    html:
      `<html><body>` +
      `<p>By 2024, 65% of 1,200 firms cut costs 30%, per <a href="https://www.reuters.com/b">Reuters</a>.</p>` +
      `<p>Response times fell 22% to 8.5 hours, per <a href="https://www.nih.gov/c">NIH</a>.</p>` +
      `<blockquote>Retention reached 90%, per the <a href="https://en.wikipedia.org/a">industry report</a>.</blockquote>` +
      `</body></html>`,
    internalLinkCount: 25,
    listCount: 3,
    listItemCount: 12,
    tableCount: 1,
    blockquoteCount: 1,
    paragraphCount: 10,
    longParagraphCount: 1,
    ...overrides,
  });
}

/** An article failing every measurable signal (article, so every signal applies). */
function brokenPage(): CrawledPage {
  return makePage({
    url: "http://broken.example/blog/broken-post",
    statusCode: 500,
    title: null,
    metaDescription: null,
    metaAuthor: null,
    headings: [],
    jsonLdBlocks: [],
    outboundLinks: [],
    hasAboutOrContactLink: false,
    renderedText: "thin",
    wordCount: 10,
    hasServerRenderedContent: false,
    robotsAllowsAiBots: false,
    hasLlmsTxt: false,
    lastModified: daysAgo(900),
    listCount: 0,
    listItemCount: 0,
    tableCount: 0,
    blockquoteCount: 0,
    paragraphCount: 1,
    longParagraphCount: 1,
    internalLinkCount: 0,
    imageCount: 0,
    imagesWithAlt: 0,
    hasViewportMeta: false,
    hasCanonical: false,
    hasOpenGraph: false,
    htmlLang: null,
  });
}

describe("scoreAiAuthority", () => {
  it("returns exactly the 7 AI signals", () => {
    const a = scoreAiAuthority(optimizedPage());
    expect(a.signals.map((s) => s.key).sort()).toEqual(
      [
        "aiCrawlability",
        "answerability",
        "brandMentions",
        "eeat",
        "factDensity",
        "freshness",
        "schema",
      ].sort(),
    );
  });

  it("a fully-optimized page scores AI ≥ 90", () => {
    const a = scoreAiAuthority(optimizedPage());
    expect(a.total).toBeGreaterThanOrEqual(90);
    expect(a.total).toBeLessThanOrEqual(100);
  });
});

describe("scoreTraditionalAuthority", () => {
  it("returns exactly the 5 traditional signals", () => {
    const t = scoreTraditionalAuthority(optimizedPage());
    expect(t.signals.map((s) => s.key).sort()).toEqual(
      ["backlinks", "contentQuality", "onPageOptimization", "technicalSeo", "topicalAuthority"].sort(),
    );
  });

  it("a fully-optimized page scores Traditional ≥ 90", () => {
    expect(scoreTraditionalAuthority(optimizedPage()).total).toBeGreaterThanOrEqual(90);
  });
});

describe("composeScore renormalization", () => {
  it("ignores unmeasured signals in both the total and the coverage", () => {
    const score = composeScore([
      { key: "a", label: "A", score: 80, weight: 0.3, reason: "", fix: null },
      { key: "b", label: "B", score: null, weight: 0.5, reason: "", fix: null },
      { key: "c", label: "C", score: 40, weight: 0.2, reason: "", fix: null },
    ]);
    expect(score.total).toBe(64); // (80*.3 + 40*.2) / .5
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

describe("score range and coverage", () => {
  it("spans the full range: near-100 optimized, near-0 broken", () => {
    expect(scoreAiAuthority(optimizedPage()).total).toBeGreaterThanOrEqual(90);
    expect(scoreTraditionalAuthority(optimizedPage()).total).toBeGreaterThanOrEqual(90);
    // Not exactly 0: freshness deliberately floors above zero (recency is
    // topic-dependent), so even a fully-broken page keeps a little freshness credit.
    expect(scoreAiAuthority(brokenPage()).total).toBeLessThan(10);
    expect(scoreTraditionalAuthority(brokenPage()).total).toBeLessThan(15);
  });

  it("reports how much of each model actually ran (off-page signals excluded)", () => {
    const page = optimizedPage();
    // AI: everything but brandMentions (0.08).
    expect(scoreAiAuthority(page).coverage).toBeCloseTo(0.92);
    // Traditional: everything but backlinks (0.22).
    expect(scoreTraditionalAuthority(page).coverage).toBeCloseTo(0.78);
  });
});

describe("gating caps on fundamentals", () => {
  it("leaves a page that clears every fundamental uncapped", () => {
    expect(scoreAiAuthority(optimizedPage()).caps).toEqual([]);
    expect(scoreTraditionalAuthority(optimizedPage()).caps).toEqual([]);
  });

  it("caps an otherwise-excellent page that every AI search crawler is blocked from", () => {
    // Content signals are all strong, so the weighted score stays high; the
    // cap is what stops it reading as citable.
    const page = optimizedPage({
      robotsAllowsAiBots: false,
      crawlerAccess: {
        ...optimizedPage().crawlerAccess,
        openaiSearch: "blocked",
        anthropicSearch: "blocked",
        perplexitySearch: "blocked",
      },
    });
    const ai = scoreAiAuthority(page);
    expect(ai.total).toBe(40);
    expect(ai.caps?.map((c) => c.id)).toEqual(["crawlable"]);
  });

  it("caps a strong page whose Googlebot is blocked on the traditional score", () => {
    const page = optimizedPage({
      crawlerAccess: { ...optimizedPage().crawlerAccess, googleSearch: "blocked" },
    });
    expect(scoreTraditionalAuthority(page).total).toBe(30);
    expect(scoreAiAuthority(page).total).toBeGreaterThanOrEqual(90);
  });

  it("caps a strong page served over plain HTTP on the traditional score", () => {
    const t = scoreTraditionalAuthority(optimizedPage({ url: "http://example.com/guide-to-widgets" }));
    expect(t.total).toBe(65);
    expect(t.caps?.map((c) => c.id)).toEqual(["secure"]);
  });

  it("doesn't move a broken page that's already below every ceiling", () => {
    const ai = scoreAiAuthority(brokenPage());
    expect(ai.caps?.length).toBeGreaterThan(0);
    expect(ai.total).toBe(composeScore(ai.signals).total);
  });
});
