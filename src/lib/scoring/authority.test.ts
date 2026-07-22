import { describe, it, expect } from "vitest";
import type { CrawledPage } from "./types";
import { scoreAiAuthority, scoreTraditionalAuthority } from "./authority";

const daysAgo = (n: number) =>
  new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();

function optimizedPage(overrides: Partial<CrawledPage> = {}): CrawledPage {
  return {
    url: "https://example.com/",
    fetchedAt: new Date().toISOString(),
    statusCode: 200,
    html: "<html></html>",
    renderedText:
      "By Jane Doe, author. See sources at https://source.example for more.",
    title: "Example Title",
    metaDescription: "An example meta description.",
    headings: [{ level: 1, text: "Main" }],
    jsonLdBlocks: [{ "@type": "Organization" }, { "@type": "WebSite" }],
    wordCount: 700,
    hasServerRenderedContent: true,
    robotsAllowsAiBots: true,
    hasLlmsTxt: true,
    lastModified: daysAgo(5),
    ...overrides,
  };
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
