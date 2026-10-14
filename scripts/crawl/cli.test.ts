import { describe, it, expect } from "vitest";
import { formatData, formatReport, formatSite } from "./cli";
import { buildReport } from "../../src/lib/scoring/report";
import { extractPageData } from "../../src/lib/crawler/extract-data";
import { makePage } from "../../src/lib/scoring/test-fixtures";
import type { SiteReport } from "../../src/lib/crawler/assess-site";

describe("crawl CLI output", () => {
  it("formats a page report with both scores and numbered fixes", () => {
    const out = formatReport(buildReport(makePage({ jsonLdBlocks: [] })));
    expect(out).toMatch(/^https:\/\/example\.com\//);
    expect(out).toMatch(/AI Readiness: \d+\/100/);
    expect(out).toMatch(/Traditional SEO: \d+\/100/);
    expect(out).toMatch(/\n {2}1\. /);
  });

  it("formats structured data, omitting fields the page doesn't have", () => {
    const out = formatData(
      extractPageData(
        makePage({
          jsonLdBlocks: [
            {
              "@type": "Product",
              name: "Widget",
              offers: { "@type": "Offer", price: "9.99", priceCurrency: "USD" },
            },
          ],
        }),
      ),
    );
    expect(out).toContain("Product          Widget");
    expect(out).toContain("Price          9.99 USD");
    expect(out).not.toContain("Organization");
    expect(out).not.toContain("Article");
  });

  it("formats a site scan with per-page rows and failures", () => {
    const site: SiteReport = {
      origin: "https://acme.com",
      sitemaps: [],
      pages: [
        { url: "https://acme.com/", source: "entry", ok: true, ai: 50, traditional: 80, topFixes: [], data: null },
        { url: "https://acme.com/about", source: "link", ok: true, ai: 40, traditional: 70, topFixes: [], data: null },
        { url: "https://acme.com/x", source: "link", ok: false, ai: null, traditional: null, topFixes: [], error: "timeout", data: null },
      ],
      averageAi: 45,
      averageTraditional: 75,
      weakestPages: [],
      commonFixes: [{ fix: "Add schema", count: 2 }],
      truncated: false,
      linkDiscovered: 2,
      sitemapHostMismatches: 3,
      brokenPages: 1,
      blockedByRobots: 1,
      crawlDelay: 5,
    };
    const out = formatSite(site);
    expect(out).toContain("scored 2 of 3 pages");
    expect(out).toContain("skipped by robots.txt: 1   crawl-delay: 5s");
    expect(out).toContain("/about  (via link)");
    expect(out).toContain("/x  FAILED: timeout");
    expect(out).toContain("×2  Add schema");
    expect(out).toContain("Structured data: none found");
    expect(out).toContain("broken pages (HTTP errors): 1");
    expect(out).toContain("sitemap lists 3 URL(s) on the wrong host (should be acme.com)");
  });
});
