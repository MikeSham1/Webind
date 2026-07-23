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

  it("scores an unknown date mid-range, not as year-old content", () => {
    const unknown = scoreFreshness(
      makePage({ lastModified: null, lastModifiedSource: null }),
    );
    const stale = scoreFreshness(makePage({ lastModified: daysAgo(500) }));
    expect(unknown.score).toBe(40);
    expect(unknown.score).toBeGreaterThan(stale.score as number);
    expect(unknown.fix).toMatch(/dateModified|article:modified_time/);
  });

  it("treats a future-dated lastModified as untrustworthy", () => {
    const s = scoreFreshness(makePage({ lastModified: daysAgo(-30) }));
    expect(s.score).toBe(40);
    expect(s.reason).toMatch(/future/);
    expect(s.fix).not.toBeNull();
  });

  it("names the source the date came from", () => {
    const s = scoreFreshness(
      makePage({ lastModified: daysAgo(10), lastModifiedSource: "header" }),
    );
    expect(s.reason).toMatch(/Last-Modified header/);
  });
});

describe("scoreEeat", () => {
  /** A page with none of the three E-E-A-T sub-signals. */
  const bare = {
    metaAuthor: null,
    jsonLdBlocks: [],
    outboundLinks: [],
    renderedText: "short thin page",
    wordCount: 100,
  };

  it("scores 100 with author, citations and depth", () => {
    const s = scoreEeat(makePage());
    expect(s.key).toBe("eeat");
    expect(s.weight).toBe(0.3);
    expect(s.score).toBe(100);
    expect(s.fix).toBeNull();
  });

  it("scores low when signals absent", () => {
    const s = scoreEeat(makePage(bare));
    expect(s.score).toBe(0);
    expect(s.fix).not.toBeNull();
  });

  it("accepts a JSON-LD author when there is no meta author", () => {
    const s = scoreEeat(
      makePage({
        ...bare,
        jsonLdBlocks: [{ "@type": "Article", author: { name: "Jane Doe" } }],
      }),
    );
    expect(s.score).toBe(34);
  });

  it("falls back to a visible byline", () => {
    const s = scoreEeat(
      makePage({ ...bare, renderedText: "By Jane Doe\nPublished today." }),
    );
    expect(s.score).toBe(34);
  });

  it("does not treat 'authoritative' prose as an author byline", () => {
    const s = scoreEeat(
      makePage({
        ...bare,
        renderedText: "This is an authoritative and authentic guide.",
      }),
    );
    expect(s.score).toBe(0);
  });

  it("counts real outbound links rather than URLs printed in the text", () => {
    // Printed URL, no actual links out: this is not evidence of sourcing.
    const printed = scoreEeat(
      makePage({
        ...bare,
        renderedText: "Read more at https://source.example for details.",
      }),
    );
    expect(printed.score).toBe(0);

    const linked = scoreEeat(
      makePage({
        ...bare,
        outboundLinks: [
          "https://en.wikipedia.org/wiki/A",
          "https://www.reuters.com/b",
        ],
      }),
    );
    expect(linked.score).toBe(33);
  });

  it("requires more than one distinct host to count as citing sources", () => {
    const s = scoreEeat(
      makePage({
        ...bare,
        outboundLinks: [
          "https://partner.example/a",
          "https://partner.example/b",
          "https://www.partner.example/c",
        ],
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
    expect(deep.score).toBeGreaterThan(thin.score as number);
  });
});

describe("off-page signals we cannot measure yet", () => {
  // These report `null` rather than a neutral 50 so composeScore can drop them
  // from the denominator instead of flattening the total toward the middle.
  it("scoreBrandMentions is unmeasured", () => {
    const s = scoreBrandMentions(makePage());
    expect(s.key).toBe("brandMentions");
    expect(s.weight).toBe(0.25);
    expect(s.score).toBeNull();
    expect(s.fix).toBeNull();
    expect(s.reason).toMatch(/Not measured/);
  });

  it("scoreBacklinks is unmeasured", () => {
    const s = scoreBacklinks(makePage());
    expect(s.key).toBe("backlinks");
    expect(s.weight).toBe(0.3);
    expect(s.score).toBeNull();
    expect(s.fix).toBeNull();
  });

  it("scoreEngagement is unmeasured", () => {
    const s = scoreEngagement(makePage());
    expect(s.key).toBe("engagement");
    expect(s.weight).toBe(0.1);
    expect(s.score).toBeNull();
    expect(s.fix).toBeNull();
  });
});
