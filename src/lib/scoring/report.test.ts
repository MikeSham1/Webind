import { describe, it, expect } from "vitest";
import type { CrawledPage, SignalScore } from "./types";
import { buildReport, fixPriority } from "./report";
import { daysAgo, makePage } from "./test-fixtures";

// A page with several deficiencies so there are fixes to order.
const deficientPage: CrawledPage = makePage({
  metaAuthor: null,
  outboundLinks: [],
  hasAboutOrContactLink: false,
  renderedText: "This is body text about widgets and gadgets.",
  jsonLdBlocks: [],
  hasServerRenderedContent: false,
  lastModified: null,
  lastModifiedSource: null,
});

/** buildReport ranks fixes by expected value (fixPriority), tie-broken by key. */
function expectedFixOrder(page: CrawledPage): string[] {
  const r = buildReport(page);
  const withFix = [...r.ai.signals, ...r.traditional.signals].filter(
    (s): s is SignalScore & { fix: string; score: number } =>
      s.fix !== null && s.score !== null,
  );
  return withFix
    .sort((a, b) => fixPriority(b) - fixPriority(a) || a.key.localeCompare(b.key))
    .map((s) => s.fix);
}

const sig = (key: string, score: number, weight: number): SignalScore => ({
  key,
  label: key,
  score,
  weight,
  reason: "",
  fix: "x",
});

describe("buildReport", () => {
  it("returns the url and both authority scores", () => {
    const r = buildReport(deficientPage);
    expect(r.url).toBe("https://example.com/");
    expect(r.ai.signals).toHaveLength(7);
    expect(r.traditional.signals).toHaveLength(5);
  });

  it("orders fixes by expected value and excludes null fixes", () => {
    const r = buildReport(deficientPage);
    // Every fix corresponds to a measured, deficient signal...
    for (const fix of r.prioritizedFixes) expect(typeof fix).toBe("string");
    // ...and the order matches the fixPriority ranking exactly.
    expect(r.prioritizedFixes).toEqual(expectedFixOrder(deficientPage));
  });

  it("favors a cheaper, safer fix over an equally-weighted expensive one", () => {
    // Same weighted deficit, but technicalSeo is a cheap/safe edit while
    // contentQuality is a high-effort, higher-risk content rewrite.
    const cheap = sig("technicalSeo", 50, 0.2);
    const expensive = sig("contentQuality", 50, 0.2);
    expect(fixPriority(cheap)).toBeGreaterThan(fixPriority(expensive));
  });

  it("never emits a fix for a signal it could not measure", () => {
    const r = buildReport(deficientPage);
    const unmeasured = [...r.ai.signals, ...r.traditional.signals].filter(
      (s) => s.score === null,
    );
    expect(unmeasured.map((s) => s.key).sort()).toEqual(["backlinks", "brandMentions"]);
    for (const s of unmeasured) expect(s.fix).toBeNull();
  });

  it("omits fixes entirely when every signal is already good", () => {
    const good: CrawledPage = makePage({
      title: "The Complete Guide to Widgets for Small Businesses",
      metaDescription:
        "A data-backed guide to choosing, buying, and maintaining widgets for small businesses, with pricing benchmarks and tips.",
      metaAuthor: "Jane Doe",
      outboundLinks: ["https://en.wikipedia.org/a", "https://www.reuters.com/b"],
      hasAboutOrContactLink: true,
      jsonLdBlocks: [
        { "@type": "Organization" },
        { "@type": "WebSite" },
        { "@type": "Article", author: { name: "Jane Doe" } },
        { "@type": "BreadcrumbList" },
        { "@type": "FAQPage" },
      ],
      headings: [
        { level: 1, text: "Widget Buying Guide" },
        { level: 2, text: "What is a widget?" },
        { level: 3, text: "Widget types" },
        { level: 2, text: "How much do widgets cost?" },
        { level: 3, text: "Widget pricing" },
        { level: 4, text: "Enterprise widgets" },
        { level: 2, text: "Widget best practices" },
        { level: 3, text: "Widget setup" },
        { level: 3, text: "Widget maintenance" },
        { level: 2, text: "Common widget mistakes" },
        { level: 3, text: "Widget fixes" },
        { level: 2, text: "Conclusion" },
      ],
      wordCount: 1600,
      renderedText:
        "This complete guide to widgets for small businesses shows how, by 2024, 65% of 1,200 firms cut costs 30% saving $5,000 over 12 months, up from 45% in 2023 and 38% in 2022 across 3,400 sites, a 22% gain from better widgets.",
      blockquoteCount: 1,
      internalLinkCount: 25,
      lastModified: daysAgo(3),
    });
    expect(buildReport(good).prioritizedFixes).toEqual([]);
  });
});
