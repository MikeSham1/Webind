import { describe, it, expect } from "vitest";
import {
  scoreSchema,
  scoreAiCrawlability,
  scoreFreshness,
  scoreEeat,
  scoreTechnicalSeo,
  scoreContentQuality,
  scoreTopicalAuthority,
  scoreBrandMentions,
  scoreBacklinks,
  scoreEngagement,
} from "./signals";
import { daysAgo, makePage } from "./test-fixtures";

describe("scoreSchema", () => {
  it("scores 100 with Organization and WebSite present", () => {
    const s = scoreSchema(
      makePage({
        jsonLdBlocks: [{ "@type": "Organization" }, { "@type": "WebSite" }],
      }),
    );
    expect(s.key).toBe("schema");
    expect(s.weight).toBe(0.15);
    expect(s.score).toBe(100);
    expect(s.fix).toBeNull();
  });

  it("handles @type arrays", () => {
    const s = scoreSchema(
      makePage({ jsonLdBlocks: [{ "@type": ["Organization", "WebSite"] }] }),
    );
    expect(s.score).toBe(100);
  });

  it("scores deficient when schema missing", () => {
    const s = scoreSchema(
      makePage({ jsonLdBlocks: [{ "@type": "Organization" }] }),
    );
    expect(s.score).toBe(50);
    expect(s.fix).not.toBeNull();
    expect(s.reason).toMatch(/WebSite/);
  });
});

describe("scoreAiCrawlability", () => {
  it("scores 100 when fully crawlable", () => {
    const s = scoreAiCrawlability(makePage());
    expect(s.key).toBe("aiCrawlability");
    expect(s.score).toBe(100);
    expect(s.fix).toBeNull();
  });

  it("penalizes missing SSR, robots and llms.txt to floor of 0", () => {
    const s = scoreAiCrawlability(
      makePage({
        hasServerRenderedContent: false,
        robotsAllowsAiBots: false,
        hasLlmsTxt: false,
      }),
    );
    expect(s.score).toBe(0);
    expect(s.fix).not.toBeNull();
  });

  it("subtracts 40 for missing SSR only", () => {
    const s = scoreAiCrawlability(
      makePage({ hasServerRenderedContent: false }),
    );
    expect(s.score).toBe(60);
  });
});

describe("scoreFreshness", () => {
  it("scores 100 for content under 90 days", () => {
    const s = scoreFreshness(makePage({ lastModified: daysAgo(10) }));
    expect(s.key).toBe("freshness");
    expect(s.score).toBe(100);
    expect(s.fix).toBeNull();
  });

  it("scores by age buckets", () => {
    expect(scoreFreshness(makePage({ lastModified: daysAgo(120) })).score).toBe(
      60,
    );
    expect(scoreFreshness(makePage({ lastModified: daysAgo(300) })).score).toBe(
      30,
    );
    expect(scoreFreshness(makePage({ lastModified: daysAgo(500) })).score).toBe(
      0,
    );
  });

  it("scores 0 with null lastModified and offers a fix", () => {
    const s = scoreFreshness(makePage({ lastModified: null }));
    expect(s.score).toBe(0);
    expect(s.fix).not.toBeNull();
  });

  it("treats a future-dated lastModified as unknown (score 0)", () => {
    const s = scoreFreshness(makePage({ lastModified: daysAgo(-30) }));
    expect(s.score).toBe(0);
    expect(s.fix).not.toBeNull();
  });
});

describe("scoreEeat", () => {
  it("scores 100 with author, citations and depth", () => {
    const s = scoreEeat(
      makePage({
        renderedText:
          "By Jane Doe. Read more at https://source.example for details.",
        wordCount: 700,
      }),
    );
    expect(s.key).toBe("eeat");
    expect(s.weight).toBe(0.3);
    expect(s.score).toBe(100);
    expect(s.fix).toBeNull();
  });

  it("scores low when signals absent", () => {
    const s = scoreEeat(
      makePage({ renderedText: "short thin page", wordCount: 100 }),
    );
    expect(s.score).toBe(0);
    expect(s.fix).not.toBeNull();
  });

  it("does not treat 'authoritative' prose as an author byline", () => {
    const s = scoreEeat(
      makePage({
        renderedText: "This is an authoritative and authentic guide.",
        wordCount: 100,
      }),
    );
    // No byline and no citations -> only depth could score, and depth is off.
    expect(s.score).toBe(0);
  });

  it("does not treat the bare word 'http' in prose as a citation", () => {
    const s = scoreEeat(
      makePage({
        renderedText: "The HTTP protocol underpins the web.",
        wordCount: 100,
      }),
    );
    expect(s.score).toBe(0);
  });
});

describe("scoreTechnicalSeo", () => {
  it("scores 100 when all technical basics present", () => {
    const s = scoreTechnicalSeo(makePage());
    expect(s.key).toBe("technicalSeo");
    expect(s.weight).toBe(0.2);
    expect(s.score).toBe(100);
    expect(s.fix).toBeNull();
  });

  it("penalizes missing title, meta, multiple H1 and bad status", () => {
    const s = scoreTechnicalSeo(
      makePage({
        title: null,
        metaDescription: null,
        headings: [
          { level: 1, text: "A" },
          { level: 1, text: "B" },
        ],
        statusCode: 404,
      }),
    );
    expect(s.score).toBe(0);
    expect(s.fix).not.toBeNull();
  });
});

describe("scoreContentQuality", () => {
  it("scores by word count", () => {
    expect(scoreContentQuality(makePage({ wordCount: 100 })).score).toBe(20);
    expect(scoreContentQuality(makePage({ wordCount: 400 })).score).toBe(60);
    const good = scoreContentQuality(makePage({ wordCount: 800 }));
    expect(good.score).toBe(100);
    expect(good.fix).toBeNull();
    expect(good.key).toBe("contentQuality");
  });
});

describe("scoreTopicalAuthority", () => {
  it("returns a score in 0..100 and rewards depth", () => {
    const thin = scoreTopicalAuthority(
      makePage({ headings: [], wordCount: 50 }),
    );
    const deep = scoreTopicalAuthority(
      makePage({
        headings: Array.from({ length: 12 }, (_, i) => ({
          level: 2,
          text: `H${i}`,
        })),
        wordCount: 2000,
      }),
    );
    expect(thin.key).toBe("topicalAuthority");
    expect(thin.score).toBeGreaterThanOrEqual(0);
    expect(deep.score).toBeLessThanOrEqual(100);
    expect(deep.score).toBeGreaterThan(thin.score);
  });
});

describe("MVP off-page neutral signals", () => {
  it("scoreBrandMentions is neutral 50", () => {
    const s = scoreBrandMentions(makePage());
    expect(s.key).toBe("brandMentions");
    expect(s.weight).toBe(0.25);
    expect(s.score).toBe(50);
    expect(s.fix).toBeNull();
    expect(s.reason).toMatch(/off-page/);
  });

  it("scoreBacklinks is neutral 50", () => {
    const s = scoreBacklinks(makePage());
    expect(s.key).toBe("backlinks");
    expect(s.weight).toBe(0.3);
    expect(s.score).toBe(50);
    expect(s.fix).toBeNull();
  });

  it("scoreEngagement is neutral 50", () => {
    const s = scoreEngagement(makePage());
    expect(s.key).toBe("engagement");
    expect(s.weight).toBe(0.1);
    expect(s.score).toBe(50);
    expect(s.fix).toBeNull();
  });
});
