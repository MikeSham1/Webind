import { describe, it, expect } from "vitest";
import type { CrawledPage } from "./types";
import { scoreAiAuthority, scoreTraditionalAuthority } from "./authority";
import { daysAgo, makePage } from "./test-fixtures";

function optimizedPage(overrides: Partial<CrawledPage> = {}): CrawledPage {
  return makePage({
    renderedText:
      "By Jane Doe, author. See sources at https://source.example for more.",
    jsonLdBlocks: [{ "@type": "Organization" }, { "@type": "WebSite" }],
    lastModified: daysAgo(5),
    ...overrides,
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
