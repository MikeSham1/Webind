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

  it("penalizes a missing date on an article, but not on a homepage", () => {
    const article = scoreFreshness(
      makePage({ url: "https://example.com/blog/x", lastModified: null, lastModifiedSource: null }),
    );
    expect(article.score).toBe(40);
    expect(article.fix).toMatch(/dateModified|article:modified_time/);

    const home = scoreFreshness(
      makePage({ url: "https://example.com/", lastModified: null, lastModifiedSource: null }),
    );
    expect(home.score).toBe(70); // not time-sensitive; not penalized
    expect(home.fix).toBeNull();
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

  it("maxes with author, about link, org+social schema, and 3 cited hosts", () => {
    const s = scoreEeat(
      makePage({
        metaAuthor: "Jane Doe",
        hasAboutOrContactLink: true,
        jsonLdBlocks: [{ "@type": "Organization", name: "Acme", sameAs: ["https://x.com/acme"] }],
        outboundLinks: [
          "https://en.wikipedia.org/a",
          "https://www.reuters.com/b",
          "https://www.nih.gov/c",
        ],
      }),
    );
    expect(s.weight).toBe(0.2);
    // author 35 + about 20 + org 15 + social 10 + citations 30 = 110 → clamp 100.
    expect(s.score).toBe(100);
    expect(s.fix).toBeNull();
  });

  it("graduates citation credit by distinct host count (on an article page)", () => {
    // A non-homepage page so authorship (0) doesn't add a homepage floor.
    const at = "https://example.com/post";
    const oneHost = scoreEeat(makePage({ ...bare, url: at, outboundLinks: ["https://a.com/x"] }));
    const twoHosts = scoreEeat(
      makePage({ ...bare, url: at, outboundLinks: ["https://a.com/x", "https://b.com/y"] }),
    );
    expect(oneHost.score).toBe(15);
    expect(twoHosts.score).toBe(22);
  });

  it("credits a named author (35) via meta, JSON-LD, or byline", () => {
    expect(scoreEeat(makePage({ ...bare, metaAuthor: "Jane Doe" })).score).toBe(35);
    expect(
      scoreEeat(makePage({ ...bare, jsonLdBlocks: [{ "@type": "Article", author: "Jane" }] }))
        .score,
    ).toBe(35);
    expect(scoreEeat(makePage({ ...bare, renderedText: "By Jane Doe\nPublished." })).score).toBe(35);
  });

  it("does not tank a homepage for a missing byline (bylines live on article pages)", () => {
    // A bare homepage with no byline still gets the identity floor, not zero.
    const homepage = scoreEeat(makePage({ ...bare, url: "https://example.com/" }));
    expect(homepage.score).toBe(12);
    // A homepage that identifies its owner (about link) scores meaningfully...
    const identified = scoreEeat(
      makePage({ ...bare, url: "https://example.com/", hasAboutOrContactLink: true }),
    );
    expect(identified.score).toBe(40); // author-floor 20 + about 20
    // ...and the "no byline" nag never appears on a homepage.
    expect(identified.fix ?? "").not.toMatch(/byline/);
  });

  it("does not treat 'authoritative' prose as authorship (no 35-pt author credit)", () => {
    const s = scoreEeat(
      makePage({ ...bare, url: "https://example.com/post", renderedText: "An authoritative, authentic guide." }),
    );
    // Article page, no real byline → no author credit at all.
    expect(s.score).toBe(0);
  });
});

describe("scoreAnswerability", () => {
  it("maxes with lists, table, Q&A headings, structure, and short paragraphs (no FAQ schema needed)", () => {
    const s = scoreAnswerability(
      makePage({
        url: "https://example.com/blog/guide", // Q&A structure applies to articles
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

  it("credits question headings on an article, but not on a homepage", () => {
    const opts = {
      jsonLdBlocks: [],
      headings: [
        { level: 2, text: "What is a widget?" },
        { level: 2, text: "How much does it cost?" },
      ],
    };
    // Article: 2 question headings → 25 of the 100.
    const article = scoreAnswerability(makePage({ ...opts, url: "https://example.com/blog/widgets" }));
    expect(article.score).toBeGreaterThanOrEqual(25);
    // Homepage: Q&A structure isn't its job, so those headings earn no Q&A credit
    // and it's never told to add question headings.
    const home = scoreAnswerability(makePage({ ...opts, url: "https://example.com/" }));
    expect(home.fix ?? "").not.toMatch(/question-style headings/);
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

describe("scoreFactDensity (Evidence Integrity)", () => {
  it("rewards a claim cited to an external source in place", () => {
    const s = scoreFactDensity(
      makePage({
        url: "https://acme.com/a",
        html: `<html><body><p>Revenue rose 42%, per <a href="https://sec.gov/x">the SEC filing</a>.</p></body></html>`,
        outboundLinks: ["https://sec.gov/x"],
        blockquoteCount: 1,
      }),
    );
    expect(s.key).toBe("factDensity");
    expect(s.label).toBe("Evidence Integrity");
    expect(s.score).toBeGreaterThan(70); // full coverage + a source + a quote
    expect(s.fix).toBeNull();
  });

  it("scores thin, source-less prose low and asks for sources", () => {
    const s = scoreFactDensity(
      makePage({
        url: "https://acme.com/a",
        html: `<html><body><p>We help businesses grow with great service and support.</p></body></html>`,
        outboundLinks: [],
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
  it("maxes with breadth, internal links, AND a focused topic", () => {
    const thin = scoreTopicalAuthority(
      makePage({ headings: [], internalLinkCount: 0, renderedText: "" }),
    );
    const deep = scoreTopicalAuthority(
      makePage({
        title: "Widget Buying Handbook",
        // 12 headings across 4 levels, every one on-topic (widget/buying/handbook).
        headings: Array.from({ length: 12 }, (_, i) => ({
          level: (i % 4) + 1,
          text: `Widget buying handbook ${i}`,
        })),
        renderedText:
          "This widget buying handbook covers widget buying, handbook to handbook.",
        internalLinkCount: 25,
      }),
    );
    expect(thin.score).toBe(0);
    expect(deep.score).toBe(100);
  });

  it("penalizes a structurally-rich page that lacks topical focus", () => {
    const base = { internalLinkCount: 25, title: "Widget Buying Handbook" };
    const focused = scoreTopicalAuthority(
      makePage({
        ...base,
        headings: Array.from({ length: 12 }, (_, i) => ({
          level: (i % 4) + 1,
          text: `Widget buying handbook ${i}`,
        })),
        renderedText: "widget buying handbook, all about widget buying.",
      }),
    );
    const scattered = scoreTopicalAuthority(
      makePage({
        ...base,
        headings: Array.from({ length: 12 }, (_, i) => ({
          level: (i % 4) + 1,
          text: `Miscellaneous section ${i}`,
        })),
        renderedText: "assorted unrelated commentary on sundry matters.",
      }),
    );
    // Same structure and link count; only topical focus differs.
    expect(focused.score as number).toBeGreaterThan(scattered.score as number);
    expect(scattered.fix).toMatch(/core topic terms/);
  });

  // Focus is the share of title/H1 terms found in headings and body, so these
  // compare reasons ("N% topic focus") on pages identical in every other way.
  const focusOf = (title: string, headingText: string, body: string): number => {
    const s = scoreTopicalAuthority(
      makePage({
        title,
        headings: [{ level: 2, text: headingText }],
        renderedText: body,
        internalLinkCount: 25,
      }),
    );
    return Number(/(\d+)% topic focus/.exec(s.reason)?.[1]);
  };

  it("matches whole words, not fragments inside other words", () => {
    // "art", "seo" and "said" hide inside "start", "Seoul" and "said": a
    // substring check counted all three as present on an unrelated page.
    expect(focusOf("Art SEO Said", "Start in Seoul", "start seoul")).toBe(0);
    expect(focusOf("Art SEO", "Art and SEO", "art seo")).toBe(100);
  });

  it("tolerates singular/plural differences in either direction", () => {
    expect(focusOf("Plumbing Services", "Our plumbing service", "plumbing service")).toBe(100);
    expect(focusOf("Plumbing Service", "All plumbing services", "plumbing services")).toBe(100);
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
