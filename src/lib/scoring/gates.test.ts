import { describe, it, expect } from "vitest";
import type { CrawledPage } from "./types";
import { AI_GATES, TRADITIONAL_GATES, bindingCap, capTotal, failedCaps } from "./gates";
import { makePage } from "./test-fixtures";

const ARTICLE = "https://example.com/blog/post";

const failedIds = (gates: typeof AI_GATES, page: CrawledPage) =>
  failedCaps(gates, page).map((c) => c.id).sort();

const allAiSearchBlocked = {
  ...makePage().crawlerAccess,
  openaiSearch: "blocked",
  anthropicSearch: "blocked",
  perplexitySearch: "blocked",
} as const;

describe("failedCaps", () => {
  it("returns nothing for a healthy page", () => {
    expect(failedCaps(AI_GATES, makePage({ url: ARTICLE }))).toEqual([]);
    expect(failedCaps(TRADITIONAL_GATES, makePage({ url: ARTICLE }))).toEqual([]);
  });

  it("caps AI readiness only when EVERY AI search crawler is blocked", () => {
    const oneBlocked = makePage({
      robotsAllowsAiBots: false,
      crawlerAccess: { ...makePage().crawlerAccess, perplexitySearch: "blocked" },
    });
    expect(failedIds(AI_GATES, oneBlocked)).toEqual([]);

    const allBlocked = makePage({ robotsAllowsAiBots: false, crawlerAccess: allAiSearchBlocked });
    const [cap] = failedCaps(AI_GATES, allBlocked);
    expect(cap).toMatchObject({ id: "crawlable", ceiling: 40, signal: "aiCrawlability" });
  });

  it("ignores blocked training crawlers and an unreadable robots.txt", () => {
    const page = makePage({
      crawlerAccess: {
        ...makePage().crawlerAccess,
        openaiTraining: "blocked",
        anthropicTraining: "blocked",
        geminiTraining: "blocked",
        googleSearch: "unknown",
      },
    });
    expect(failedIds(AI_GATES, page)).toEqual([]);
    expect(failedIds(TRADITIONAL_GATES, page)).toEqual([]);
  });

  it("caps traditional authority when Googlebot is blocked", () => {
    const page = makePage({
      crawlerAccess: { ...makePage().crawlerAccess, googleSearch: "blocked" },
    });
    expect(failedIds(TRADITIONAL_GATES, page)).toEqual(["indexable"]);
    // Googlebot isn't an AI search crawler here; AI readiness is untouched.
    expect(failedIds(AI_GATES, page)).toEqual([]);
  });

  it("flags a non-200, a JS shell, and thin content for AI", () => {
    const page = makePage({
      url: ARTICLE,
      statusCode: 500,
      hasServerRenderedContent: false,
      wordCount: 20,
    });
    expect(failedIds(AI_GATES, page)).toEqual(["reachable", "renderable", "substantive"]);
  });

  it("flags plain HTTP, a missing title, and thin content for traditional", () => {
    const page = makePage({ url: "http://example.com/blog/post", title: null, wordCount: 20 });
    expect(failedIds(TRADITIONAL_GATES, page)).toEqual(["identified", "secure", "substantive"]);
  });

  it("doesn't call a short homepage or category page thin", () => {
    for (const url of ["https://example.com/", "https://example.com/category/widgets"]) {
      const page = makePage({ url, wordCount: 60 });
      expect(failedIds(AI_GATES, page)).toEqual([]);
      expect(failedIds(TRADITIONAL_GATES, page)).toEqual([]);
    }
  });
});

describe("capTotal + bindingCap", () => {
  it("leaves the total alone when nothing failed", () => {
    expect(capTotal(93, [])).toBe(93);
    expect(bindingCap([])).toBeNull();
    expect(bindingCap(undefined)).toBeNull();
  });

  it("caps at the LOWEST ceiling among failed fundamentals", () => {
    // Every AI search crawler blocked (40) and a JS shell (50) → 40.
    const caps = failedCaps(
      AI_GATES,
      makePage({ crawlerAccess: allAiSearchBlocked, hasServerRenderedContent: false }),
    );
    expect(caps.map((c) => c.id).sort()).toEqual(["crawlable", "renderable"]);
    expect(capTotal(95, caps)).toBe(40);
    expect(bindingCap(caps)?.id).toBe("crawlable");
  });

  it("never raises a score that's already below the ceiling", () => {
    const caps = failedCaps(AI_GATES, makePage({ crawlerAccess: allAiSearchBlocked }));
    expect(capTotal(12, caps)).toBe(12);
  });
});
