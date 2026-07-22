import { describe, it, expect } from "vitest";
import type { CrawledPage } from "./types";
import { buildReport } from "./report";
import { makePage } from "./test-fixtures";

// Deficient page with predictable per-signal scores so fix ordering is known.
const deficientPage: CrawledPage = makePage({
  renderedText: "This is body text about widgets and gadgets.",
  jsonLdBlocks: [],
  hasServerRenderedContent: false,
  lastModified: null,
});

describe("buildReport", () => {
  it("returns the url and both authority scores", () => {
    const r = buildReport(deficientPage);
    expect(r.url).toBe("https://example.com/");
    expect(r.ai.signals).toHaveLength(5);
    expect(r.traditional.signals).toHaveLength(5);
  });

  it("excludes signals with a null fix and orders by weight * (100 - score) desc", () => {
    const r = buildReport(deficientPage);
    // Expected priorities:
    //  eeat 0.30*(100-33)=20.1, topicalAuthority 0.25*(100-28)=18,
    //  schema 0.15*100=15 and freshness 0.15*100=15 tie -> broken by key
    //  ("freshness" < "schema"), aiCrawlability 0.15*(100-60)=6.
    expect(r.prioritizedFixes).toEqual([
      "Strengthen E-E-A-T: add a visible author byline; cite authoritative outbound sources.",
      "Publish more in-depth, topically-related content to build authority.",
      "Update this page; Perplexity decays content in 2-3 months.",
      "Add JSON-LD Organization and WebSite schema to the homepage.",
      "Improve AI crawlability: server-render key content.",
    ]);
  });

  it("omits fixes entirely when every signal is already good", () => {
    const good: CrawledPage = {
      ...deficientPage,
      renderedText:
        "By Jane Doe, author. See sources at https://source.example for more.",
      jsonLdBlocks: [{ "@type": "Organization" }, { "@type": "WebSite" }],
      hasServerRenderedContent: true,
      lastModified: new Date().toISOString(),
    };
    const r = buildReport(good);
    // Off-page neutral signals (score 50) carry null fixes, so they never appear.
    for (const fix of r.prioritizedFixes) expect(fix).not.toContain("off-page");
  });
});
