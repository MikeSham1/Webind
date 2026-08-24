import { describe, it, expect } from "vitest";
import {
  scoreAiCrawlability,
  scoreAnswerability,
  scoreBacklinks,
  scoreBrandMentions,
  scoreContentQuality,
  scoreEeat,
  scoreFactDensity,
  scoreFreshness,
  scoreOnPageOptimization,
  scoreSchema,
  scoreTechnicalSeo,
  scoreTopicalAuthority,
} from "./signals";
import { daysAgo, makePage } from "./test-fixtures";

describe("scoreSchema", () => {
  it("rewards Organization, WebSite, a content type, breadcrumb, and person", () => {
    const s = scoreSchema(
      makePage({
        jsonLdBlocks: [
          { "@type": "Organization" },
          { "@type": "WebSite" },
          { "@type": "Article", author: { name: "Jane" } },
          { "@type": "BreadcrumbList" },
        ],
      }),
    );
    expect(s.key).toBe("schema");
    expect(s.weight).toBe(0.14);
    expect(s.score).toBe(100);
    expect(s.fix).toBeNull();
  });

  it("gives partial credit for Organization + WebSite only", () => {
    const s = scoreSchema(
      makePage({ jsonLdBlocks: [{ "@type": ["Organization", "WebSite"] }] }),
    );
    expect(s.score).toBe(40);
    expect(s.reason).toMatch(/content type/);
  });

  it("scores 0 with no structured data", () => {
    expect(scoreSchema(makePage({ jsonLdBlocks: [] })).score).toBe(0);
  });
});

describe("scoreAiCrawlability", () => {
  it("scores 100 when fully crawlable", () => {
    expect(scoreAiCrawlability(makePage()).score).toBe(100);
  });

  it("penalizes missing SSR (-55) and blocked AI crawlers (-45); ignores llms.txt", () => {
    expect(scoreAiCrawlability(makePage({ hasServerRenderedContent: false })).score).toBe(45);
    expect(scoreAiCrawlability(makePage({ robotsAllowsAiBots: false })).score).toBe(55);
    // llms.txt is no longer scored — its absence is not a deficiency.
    expect(scoreAiCrawlability(makePage({ hasLlmsTxt: false })).score).toBe(100);
  });
});

describe("scoreFreshness", () => {
  it("decays gently by age and never floors to zero", () => {
    expect(scoreFreshness(makePage({ lastModified: daysAgo(10) })).score).toBe(100);
    expect(scoreFreshness(makePage({ lastModified: daysAgo(120) })).score).toBe(100);
    expect(scoreFreshness(makePage({ lastModified: daysAgo(300) })).score).toBe(75);
    expect(scoreFreshness(makePage({ lastModified: daysAgo(500) })).score).toBe(55);
    expect(scoreFreshness(makePage({ lastModified: daysAgo(900) })).score).toBe(40);
  });

  it("scores an unknown date mid-range, not as stale", () => {
    const s = scoreFreshness(makePage({ lastModified: null, lastModifiedSource: null }));
    expect(s.score).toBe(40);
    expect(s.fix).toMatch(/dateModified|article:modified_time/);
  });

  it("treats a future date as untrustworthy", () => {
    expect(scoreFreshness(makePage({ lastModified: daysAgo(-30) })).score).toBe(40);
  });
});

describe("scoreEeat", () => {
  const bare = {
    metaAuthor: null,
    jsonLdBlocks: [],
    outboundLinks: [],
    hasAboutOrContactLink: false,
    renderedText: "short thin page",
  };

  it("maxes with author, 3 cited hosts, and an about/contact link", () => {
    const s = scoreEeat(
      makePage({
        outboundLinks: [
          "https://en.wikipedia.org/a",
          "https://www.reuters.com/b",
          "https://www.nih.gov/c",
        ],
      }),
    );
    expect(s.weight).toBe(0.2);
    expect(s.score).toBe(100);
    expect(s.fix).toBeNull();
  });

  it("graduates citation credit by distinct host count", () => {
    const oneHost = scoreEeat(makePage({ ...bare, outboundLinks: ["https://a.com/x"] }));
    const twoHosts = scoreEeat(
      makePage({ ...bare, outboundLinks: ["https://a.com/x", "https://b.com/y"] }),
    );
    // author 0 + about 0 → citation portion only: 1 host → 18, 2 hosts → 28.
    expect(oneHost.score).toBe(18);
    expect(twoHosts.score).toBe(28);
  });

  it("credits a named author (45) via meta, JSON-LD, or byline", () => {
    expect(scoreEeat(makePage({ ...bare, metaAuthor: "Jane Doe" })).score).toBe(45);
    expect(
      scoreEeat(makePage({ ...bare, jsonLdBlocks: [{ "@type": "Article", author: "Jane" }] }))
        .score,
    ).toBe(45);
    expect(scoreEeat(makePage({ ...bare, renderedText: "By Jane Doe\nPublished." })).score).toBe(45);
  });

  it("does not treat 'authoritative' prose as authorship", () => {
    expect(
      scoreEeat(makePage({ ...bare, renderedText: "An authoritative, authentic guide." })).score,
    ).toBe(0);
  });
});

describe("scoreAnswerability", () => {
  it("maxes with lists, table, Q&A headings, structure, and short paragraphs (no FAQ schema needed)", () => {
    const s = scoreAnswerability(
      makePage({
        listCount: 2,
        listItemCount: 8,
        tableCount: 1,
        jsonLdBlocks: [], // deliberately no FAQPage schema — structure alone maxes it
        headings: [
          { level: 1, text: "Guide" },
          { level: 2, text: "What is it?" },
          { level: 2, text: "How much does it cost?" },
        ],
        paragraphCount: 10,
        longParagraphCount: 1,
      }),
    );
    expect(s.key).toBe("answerability");
    expect(s.score).toBe(100);
  });

  it("credits question headings even without FAQ schema", () => {
    const s = scoreAnswerability(
      makePage({
        jsonLdBlocks: [],
        headings: [
          { level: 2, text: "What is a widget?" },
          { level: 2, text: "How much does it cost?" },
        ],
      }),
    );
    // faq: 2 question headings → 25 of the 100.
    expect(s.score).toBeGreaterThanOrEqual(25);
  });

  it("scores low for an unstructured wall of text", () => {
    const s = scoreAnswerability(
      makePage({
        listCount: 0,
        listItemCount: 0,
        tableCount: 0,
        jsonLdBlocks: [],
        headings: [],
        paragraphCount: 4,
        longParagraphCount: 4,
      }),
    );
    expect(s.score).toBe(0);
    expect(s.fix).not.toBeNull();
  });
});

describe("scoreFactDensity", () => {
  it("rewards ~1 statistic per 100 words plus a quote", () => {
    const s = scoreFactDensity(
      makePage({
        wordCount: 100,
        renderedText: "Revenue rose 42% to $1,200 in 2024 across 3,400 firms.",
        blockquoteCount: 1,
      }),
    );
    // 4+ stat tokens over 100 words → density ≥ 1 → 60, plus blockquote → 40.
    expect(s.key).toBe("factDensity");
    expect(s.score).toBe(100);
  });

  it("scores thin, quote-less prose low", () => {
    const s = scoreFactDensity(
      makePage({
        wordCount: 500,
        renderedText: "We help businesses grow with our great service and support.",
        blockquoteCount: 0,
      }),
    );
    expect(s.score).toBeLessThan(30);
    expect(s.fix).not.toBeNull();
  });
});

describe("scoreTechnicalSeo", () => {
  it("scores 100 with all technical signals present", () => {
    const s = scoreTechnicalSeo(makePage());
    expect(s.weight).toBe(0.22);
    expect(s.score).toBe(100);
    expect(s.fix).toBeNull();
  });

  it("penalizes HTTP, missing canonical/viewport, and missing title/meta", () => {
    const s = scoreTechnicalSeo(
      makePage({
        url: "http://example.com/",
        title: null,
        metaDescription: null,
        hasCanonical: false,
        hasViewportMeta: false,
      }),
    );
    expect(s.score).toBeLessThan(50);
    expect(s.fix).toMatch(/HTTPS|title|canonical|viewport/i);
  });
});

describe("scoreContentQuality", () => {
  it("flags too-thin content but does not reward raw length", () => {
    // Under ~150 words reads as too thin to answer the topic.
    expect(scoreContentQuality(makePage({ wordCount: 100, headings: [] })).score).toBe(25);
    // Adequate length, but a single heading → no structure bonus. Note more
    // words alone would NOT raise this further — there is no ideal length.
    expect(
      scoreContentQuality(makePage({ wordCount: 700, headings: [{ level: 1, text: "A" }] })).score,
    ).toBe(72);
    // Adequate + well-structured (default fixture has lists/tables + 3 headings).
    const structured = scoreContentQuality(
      makePage({
        wordCount: 500,
        headings: [
          { level: 1, text: "A" },
          { level: 2, text: "B" },
          { level: 2, text: "C" },
        ],
      }),
    );
    expect(structured.score).toBe(90); // 72 adequacy + 18 structure
  });
});

describe("scoreTopicalAuthority", () => {
  it("rewards heading breadth and internal links", () => {
    const thin = scoreTopicalAuthority(makePage({ headings: [], internalLinkCount: 0 }));
    const deep = scoreTopicalAuthority(
      makePage({
        headings: Array.from({ length: 12 }, (_, i) => ({ level: (i % 4) + 1, text: `H${i}` })),
        internalLinkCount: 25,
      }),
    );
    expect(thin.score).toBe(0);
    expect(deep.score).toBe(100);
  });
});

describe("scoreOnPageOptimization", () => {
  it("rewards well-sized title/meta and Open Graph", () => {
    const s = scoreOnPageOptimization(
      makePage({
        title: "A Well Sized Title For Search Results Pages",
        metaDescription:
          "A meta description in the ideal 70 to 165 character range that clearly summarizes the page for search and social.",
        hasOpenGraph: true,
      }),
    );
    expect(s.score).toBe(100);
  });

  it("does not penalize a short title (no minimum length); only absence and truncation count", () => {
    const s = scoreOnPageOptimization(
      makePage({ title: "Hi", metaDescription: null, hasOpenGraph: false }),
    );
    expect(s.score).toBe(35); // title present 35 + no meta 0 + no OG 0
  });
});

describe("off-page signals we cannot measure yet", () => {
  it("scoreBrandMentions is unmeasured", () => {
    const s = scoreBrandMentions(makePage());
    expect(s.key).toBe("brandMentions");
    expect(s.weight).toBe(0.08);
    expect(s.score).toBeNull();
  });

  it("scoreBacklinks is unmeasured", () => {
    const s = scoreBacklinks(makePage());
    expect(s.key).toBe("backlinks");
    expect(s.weight).toBe(0.22);
    expect(s.score).toBeNull();
  });
});
