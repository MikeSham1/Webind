import { describe, it, expect, vi } from "vitest";
import { assessSite as assessSiteRaw, type AssessSiteOptions } from "./assess-site";
import { makePage } from "../scoring/test-fixtures";
import type { CrawledPage } from "../scoring/types";
import type { discoverSitemapUrls } from "./sitemap";

/** assessSite with redirect resolution stubbed out, so no test touches the network. */
function assessSite(url: string, opts: AssessSiteOptions = {}) {
  return assessSiteRaw(url, { resolveImpl: async (u) => u, ...opts });
}

/** A discovery stub returning a fixed URL list. */
function fakeDiscover(
  urls: string[],
  truncated = false,
  robotsTxt: string | null = null,
): typeof discoverSitemapUrls {
  return vi.fn(async () => ({
    sitemaps: ["https://acme.com/sitemap.xml"],
    urls,
    truncated,
    robotsTxt,
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

  it("follows internal links to fill the budget when there is no sitemap", async () => {
    const crawlImpl = fakeCrawl({
      "https://acme.com/": {
        internalLinks: [
          "https://acme.com/about",
          "https://www.acme.com/pricing/",
          "https://acme.com/", // self-link
          "https://acme.com/brochure.pdf", // file, not a page
          "https://acme.com/shop?sort=price", // faceted variant
          "https://other.com/", // off-site
        ],
      },
      "https://acme.com/about": {
        // Duplicates of already-queued pages must not be crawled again.
        internalLinks: ["https://acme.com/pricing", "https://acme.com/team"],
      },
    });
    const report = await assessSite("https://acme.com/", {
      discoverImpl: fakeDiscover([]),
      crawlImpl,
    });

    expect(report.pages.map((p) => [p.url, p.source])).toEqual([
      ["https://acme.com/", "entry"],
      ["https://acme.com/about", "link"],
      ["https://www.acme.com/pricing/", "link"],
      ["https://acme.com/team", "link"],
    ]);
    expect(report.linkDiscovered).toBe(3);
    expect(crawlImpl).toHaveBeenCalledTimes(4);
  });

  it("tops up a short sitemap with linked pages, sitemap pages first", async () => {
    const report = await assessSite("acme.com", {
      discoverImpl: fakeDiscover(["https://acme.com/", "https://acme.com/blog"]),
      crawlImpl: fakeCrawl({
        "https://acme.com/": { internalLinks: ["https://acme.com/blog/", "https://acme.com/a"] },
        "https://acme.com/blog": { internalLinks: ["https://acme.com/b", "https://acme.com/c"] },
      }),
      maxPages: 4,
    });

    expect(report.pages.map((p) => p.url)).toEqual([
      "https://acme.com/",
      "https://acme.com/blog",
      "https://acme.com/a",
      "https://acme.com/b",
    ]);
    expect(report.pages.slice(0, 2).every((p) => p.source === "sitemap")).toBe(true);
    expect(report.linkDiscovered).toBe(2);
  });

  it("does not re-crawl the page a link redirected to", async () => {
    // /old redirects to /new, and the landed page links to itself plus /x.
    const crawlImpl = vi.fn(async (url: string) =>
      url === "https://acme.com/old"
        ? makePage({
            url: "https://acme.com/new",
            internalLinks: ["https://acme.com/new", "https://acme.com/x"],
          })
        : makePage({ url, internalLinks: url === "https://acme.com/" ? ["https://acme.com/old"] : [] }),
    ) as unknown as typeof import("./crawl").crawl;
    const report = await assessSite("https://acme.com/", {
      discoverImpl: fakeDiscover([]),
      crawlImpl,
    });
    expect(report.pages.map((p) => p.url)).toEqual([
      "https://acme.com/",
      "https://acme.com/old",
      "https://acme.com/x",
    ]);
  });

  it("stays on the sitemap pages when link following is off", async () => {
    const crawlImpl = fakeCrawl({
      "https://acme.com/": { internalLinks: ["https://acme.com/about"] },
    });
    const report = await assessSite("https://acme.com/", {
      discoverImpl: fakeDiscover([]),
      crawlImpl,
      followLinks: false,
    });
    expect(report.pages).toHaveLength(1);
    expect(report.linkDiscovered).toBe(0);
  });

  it("skips sitemap pages and links that robots.txt disallows for us", async () => {
    const robots = "User-agent: *\nDisallow: /private\n";
    const crawlImpl = fakeCrawl({
      "https://acme.com/": {
        internalLinks: ["https://acme.com/private/two", "https://acme.com/about"],
      },
    });
    const report = await assessSite("acme.com", {
      discoverImpl: fakeDiscover(
        ["https://acme.com/", "https://acme.com/private/one"],
        false,
        robots,
      ),
      crawlImpl,
    });

    expect(report.pages.map((p) => p.url)).toEqual([
      "https://acme.com/",
      "https://acme.com/about",
    ]);
    expect(report.blockedByRobots).toBe(2);
    expect(crawlImpl).toHaveBeenCalledTimes(2);
  });

  it("honors Crawl-delay: one request at a time, spaced, with a bounded budget", async () => {
    const sleeps: number[] = [];
    let inFlight = 0;
    let maxInFlight = 0;
    const crawlImpl = vi.fn(async (url: string) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await Promise.resolve();
      inFlight--;
      return makePage({ url, internalLinks: [] });
    }) as unknown as typeof import("./crawl").crawl;
    const urls = Array.from({ length: 12 }, (_, i) => `https://acme.com/p${i}`);

    const report = await assessSite("acme.com", {
      discoverImpl: fakeDiscover(urls, false, "User-agent: *\nCrawl-delay: 20\n"),
      crawlImpl,
      maxPages: 12,
      sleepImpl: async (ms) => {
        sleeps.push(ms);
      },
    });

    // 20s is capped to 10s, and 60s of waiting allows 1 + 6 pages.
    expect(report.crawlDelay).toBe(10);
    expect(report.pages).toHaveLength(7);
    expect(maxInFlight).toBe(1);
    expect(sleeps).toHaveLength(6);
    expect(sleeps.every((ms) => ms > 9000 && ms <= 10000)).toBe(true);
  });

  it("shares one origin-probe cache across every crawl in a scan", async () => {
    const caches = new Set<unknown>();
    const crawlImpl = vi.fn(async (url: string, opts?: { originProbeCache?: unknown }) => {
      caches.add(opts?.originProbeCache);
      return makePage({ url, internalLinks: [] });
    }) as unknown as typeof import("./crawl").crawl;
    await assessSite("acme.com", {
      discoverImpl: fakeDiscover(["https://acme.com/a", "https://acme.com/b"]),
      crawlImpl,
    });
    expect(caches.size).toBe(1);
    expect([...caches][0]).toBeInstanceOf(Map);
  });

  it("reads robots.txt and the sitemap where the entered address redirects to", async () => {
    const discoverImpl = vi.fn(async () => ({
      sitemaps: ["https://www.acme.com/sitemap.xml"],
      urls: ["https://www.acme.com/", "https://www.acme.com/private"],
      truncated: false,
      robotsTxt: "User-agent: *\nDisallow: /private\n",
    })) as unknown as typeof discoverSitemapUrls;
    const report = await assessSite("acme.com", {
      resolveImpl: async () => "https://www.acme.com/",
      discoverImpl,
      crawlImpl: fakeCrawl({}),
    });

    // Discovery ran against the www host the bare domain redirects to...
    expect(vi.mocked(discoverImpl).mock.calls[0][0]).toBe("https://www.acme.com/");
    expect(report.origin).toBe("https://www.acme.com");
    // ...so its robots.txt rules were actually applied.
    expect(report.pages.map((p) => p.url)).toEqual(["https://www.acme.com/"]);
    expect(report.blockedByRobots).toBe(1);
  });

  it("falls back to the entered address when redirect resolution fails", async () => {
    const report = await assessSite("https://acme.com/", {
      resolveImpl: async () => {
        throw new Error("network down");
      },
      discoverImpl: fakeDiscover([]),
      crawlImpl: fakeCrawl({}),
    });
    expect(report.origin).toBe("https://acme.com");
    expect(report.pages).toHaveLength(1);
  });

  it("reports error pages as broken, keeps them out of averages, and follows their links", async () => {
    const report = await assessSite("https://acme.com/", {
      discoverImpl: fakeDiscover(["https://acme.com/", "https://acme.com/gone"]),
      crawlImpl: fakeCrawl({
        "https://acme.com/": {},
        "https://acme.com/gone": { statusCode: 404, internalLinks: ["https://acme.com/found"] },
        "https://acme.com/found": {},
      }),
    });
    const gone = report.pages.find((p) => p.url.endsWith("/gone"))!;
    expect(gone).toMatchObject({ ok: false, error: "HTTP 404", httpStatus: 404, ai: null });
    expect(report.brokenPages).toBe(1);
    // Only the two real pages are averaged; the 404's nav link was followed.
    expect(report.pages.map((p) => p.url)).toContain("https://acme.com/found");
    expect(report.weakestPages.every((p) => p.ok)).toBe(true);
  });

  it("scans sitemap URLs listed on the bare domain at the site's real www host", async () => {
    const crawlImpl = fakeCrawl({});
    const report = await assessSite("acme.com", {
      resolveImpl: async () => "https://www.acme.com/",
      discoverImpl: fakeDiscover(["https://acme.com/", "http://acme.com/about", "https://www.acme.com/team"]),
      crawlImpl,
    });
    expect(report.pages.map((p) => p.url)).toEqual([
      "https://www.acme.com/",
      "https://www.acme.com/about",
      "https://www.acme.com/team",
    ]);
    expect(report.sitemapHostMismatches).toBe(2);
  });

  it("crawls real pages before cart, login, tag and pagination pages", async () => {
    const report = await assessSite("https://acme.com/", {
      discoverImpl: fakeDiscover([]),
      crawlImpl: fakeCrawl({
        "https://acme.com/": {
          // Utility links listed first, as headers and footers often do.
          internalLinks: [
            "https://acme.com/cart",
            "https://acme.com/login",
            "https://acme.com/tag/sale",
            "https://acme.com/blog/page/7",
            "https://acme.com/products",
            "https://acme.com/about",
          ],
        },
      }),
      maxPages: 3,
    });
    expect(report.pages.map((p) => p.url)).toEqual([
      "https://acme.com/",
      "https://acme.com/products",
      "https://acme.com/about",
    ]);
  });

  it("prefers pages that more crawled pages link to", async () => {
    const report = await assessSite("https://acme.com/", {
      discoverImpl: fakeDiscover([]),
      crawlImpl: fakeCrawl({
        "https://acme.com/": {
          internalLinks: ["https://acme.com/a", "https://acme.com/b", "https://acme.com/c"],
        },
        // /a also links to /c, so /c (2 in-links) jumps ahead of /b (1).
        "https://acme.com/a": { internalLinks: ["https://acme.com/c"] },
      }),
      concurrency: 1,
      maxPages: 4,
    });
    expect(report.pages.map((p) => p.url)).toEqual([
      "https://acme.com/",
      "https://acme.com/a",
      "https://acme.com/c",
      "https://acme.com/b",
    ]);
  });

  it("still crawls utility pages once nothing better is left", async () => {
    const report = await assessSite("https://acme.com/", {
      discoverImpl: fakeDiscover([]),
      crawlImpl: fakeCrawl({
        "https://acme.com/": { internalLinks: ["https://acme.com/cart"] },
      }),
    });
    expect(report.pages.map((p) => p.url)).toEqual(["https://acme.com/", "https://acme.com/cart"]);
  });
});
