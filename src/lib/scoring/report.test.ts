import { describe, it, expect } from "vitest";
import type { CrawledPage } from "./types";
import { buildReport } from "./report";
import { makePage } from "./test-fixtures";

// Deficient page with predictable per-signal scores so fix ordering is known.
const deficientPage: CrawledPage = makePage({
  metaAuthor: null,
  outboundLinks: [],
  renderedText: "This is body text about widgets and gadgets.",
  jsonLdBlocks: [],
  hasServerRenderedContent: false,
  lastModified: null,
  lastModifiedSource: null,
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
    //  schema 0.15*100=15, freshness 0.15*(100-40)=9,
    //  aiCrawlability 0.15*(100-60)=6.
    expect(r.prioritizedFixes).toEqual([
      "Strengthen E-E-A-T: add a visible author byline or author metadata; link out to at least 2 authoritative sources.",
      "Publish more in-depth, topically-related content to build authority.",
      "Add JSON-LD Organization and WebSite schema to the homepage.",
      "Publish an explicit update date — JSON-LD `dateModified` or an `article:modified_time` meta tag — so AI engines can verify recency.",
      "Improve AI crawlability: server-render key content.",
    ]);
  });

  it("never emits a fix for a signal it could not measure", () => {
    const r = buildReport(deficientPage);
    const unmeasured = [...r.ai.signals, ...r.traditional.signals].filter(
      (s) => s.score === null,
    );
    // The three off-page signals are unmeasured, and none of them may
    // contribute advice — we have no evidence to base advice on.
    expect(unmeasured.map((s) => s.key).sort()).toEqual([
      "backlinks",
      "brandMentions",
      "engagement",
    ]);
    for (const s of unmeasured) expect(s.fix).toBeNull();
  });

  it("omits fixes entirely when every signal is already good", () => {
    const good: CrawledPage = makePage({
      metaAuthor: "Jane Doe",
      outboundLinks: [
        "https://en.wikipedia.org/wiki/A",
        "https://www.reuters.com/b",
      ],
      jsonLdBlocks: [{ "@type": "Organization" }, { "@type": "WebSite" }],
      headings: Array.from({ length: 10 }, (_, i) => ({
        level: i === 0 ? 1 : 2,
        text: `H${i}`,
      })),
      wordCount: 1600,
      hasServerRenderedContent: true,
      lastModified: new Date().toISOString(),
      lastModifiedSource: "json-ld",
    });
    expect(buildReport(good).prioritizedFixes).toEqual([]);
  });
});
