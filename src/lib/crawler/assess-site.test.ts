import { describe, it, expect, vi } from "vitest";
import { assessSite } from "./assess-site";
import { makePage } from "../scoring/test-fixtures";
import type { CrawledPage } from "../scoring/types";
import type { discoverSitemapUrls } from "./sitemap";

/** A discovery stub returning a fixed URL list. */
function fakeDiscover(
  urls: string[],
  truncated = false,
): typeof discoverSitemapUrls {
  return vi.fn(async () => ({
    sitemaps: ["https://acme.com/sitemap.xml"],
    urls,
    truncated,
  }));
}

/** A crawl stub that returns a page shaped by per-URL overrides. */
function fakeCrawl(
  byUrl: Record<string, Partial<CrawledPage> | "throw">,
) {
  return vi.fn(async (url: string) => {
    const spec = byUrl[url];
    if (spec === "throw") throw new Error("crawl failed");
    return makePage({ url, ...(spec ?? {}) });
  }) as unknown as typeof import("./crawl").crawl;
}

describe("assessSite", () => {
  it("scores every discovered page and averages the good ones", async () => {
    const urls = ["https://acme.com/", "https://acme.com/pricing"];
    const report = await assessSite("acme.com", {
      discoverImpl: fakeDiscover(urls),
      crawlImpl: fakeCrawl({
        "https://acme.com/": {},
        "https://acme.com/pricing": {},
      }),
    });

    expect(report.origin).toBe("https://acme.com");
    expect(report.pages).toHaveLength(2);
    expect(report.pages.every((p) => p.ok)).toBe(true);
    expect(report.averageAi).not.toBeNull();
    expect(report.averageTraditional).not.toBeNull();
  });

  it("records a failed crawl without aborting, excluding it from averages", async () => {
    const urls = ["https://acme.com/", "https://acme.com/broken"];
    const report = await assessSite("acme.com", {
      discoverImpl: fakeDiscover(urls),
      crawlImpl: fakeCrawl({
        "https://acme.com/": {},
        "https://acme.com/broken": "throw",
      }),
    });

    const broken = report.pages.find((p) => p.url.endsWith("/broken"))!;
    expect(broken.ok).toBe(false);
    expect(broken.error).toMatch(/crawl failed/);
    // Only the one healthy page feeds the average.
    expect(report.weakestPages).toHaveLength(1);
    expect(report.averageAi).not.toBeNull();
  });

  it("ranks the weakest pages worst-first by combined score", async () => {
    const urls = ["https://acme.com/good", "https://acme.com/bad"];
    const report = await assessSite("acme.com", {
      discoverImpl: fakeDiscover(urls),
      crawlImpl: fakeCrawl({
        // A deliberately deficient page vs a healthy one.
        "https://acme.com/good": {},
        "https://acme.com/bad": {
          title: null,
          metaDescription: null,
          jsonLdBlocks: [],
          headings: [],
          wordCount: 20,
          hasServerRenderedContent: false,
          robotsAllowsAiBots: false,
        },
      }),
    });
    expect(report.weakestPages[0].url).toBe("https://acme.com/bad");
  });

  it("surfaces fixes shared across multiple pages", async () => {
    const deficient = {
      title: null,
      metaDescription: null,
      jsonLdBlocks: [],
      wordCount: 30,
    };
    const urls = ["https://acme.com/a", "https://acme.com/b"];
    const report = await assessSite("acme.com", {
      discoverImpl: fakeDiscover(urls),
      crawlImpl: fakeCrawl({
        "https://acme.com/a": deficient,
        "https://acme.com/b": deficient,
      }),
    });
    // Both pages share deficiencies, so at least one fix recurs (count ≥ 2).
    expect(report.commonFixes.length).toBeGreaterThan(0);
    expect(report.commonFixes[0].count).toBe(2);
  });

  it("falls back to assessing the entered URL when no sitemap is found", async () => {
    const crawlImpl = fakeCrawl({ "https://acme.com/": {} });
    const report = await assessSite("https://acme.com/", {
      discoverImpl: fakeDiscover([]), // empty discovery
      crawlImpl,
    });
    expect(report.pages).toHaveLength(1);
    expect(report.pages[0].url).toBe("https://acme.com/");
    expect(crawlImpl).toHaveBeenCalledTimes(1);
  });
});
