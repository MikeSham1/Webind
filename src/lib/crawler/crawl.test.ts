import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { chromium, type Browser, type BrowserContext, type Route } from "playwright";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { crawl, crawlerUserAgent } from "./crawl";
import { BlockedUrlError } from "./ssrf";

/**
 * These tests are hermetic: every request is fulfilled from a fixture. The real
 * URL guard would resolve `acme.test` against DNS, so it is replaced with one
 * that allows everything unless a test says otherwise. `fetchImpl` stubs out
 * the out-of-band redirect-chain probe (see resolveRedirectChain in crawl.ts)
 * so it never touches the network either — without this, every test would
 * attempt a real DNS lookup for the fake `acme.test` host before falling back.
 */
const noRedirectFetch: typeof fetch = async () => new Response(null, { status: 200 });
const offline = { isUrlAllowed: async () => true, fetchImpl: noRedirectFetch };

const BODY_TEXT = "Acme builds durable, professional-grade widgets for demanding worksites. ";

const HTML = `<!doctype html>
<html lang="en">
  <head>
    <title>Acme Widgets</title>
    <meta name="description" content="We build the best widgets." />
    <meta name="author" content="Jane Doe" />
    <meta property="article:modified_time" content="2024-03-01T00:00:00Z" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta property="og:title" content="Acme Widgets" />
    <link rel="canonical" href="http://acme.test/" />
    <script type="application/ld+json">
      [
        {"@context":"https://schema.org","@type":"Organization","name":"Acme"},
        {"@context":"https://schema.org","@type":"WebSite","name":"Acme Site"}
      ]
    </script>
    <script type="application/ld+json">
      {"@context":"https://schema.org","@graph":[
        {"@type":"BreadcrumbList","name":"Crumbs"},
        {"@type":"Product","name":"Widget X"}
      ]}
    </script>
    <script type="application/ld+json">
      { this is not valid json ]]
    </script>
  </head>
  <body>
    <h1>Welcome to Acme</h1>
    <h2>Our Products</h2>
    <h3>Widgets</h3>
    <p>${BODY_TEXT.repeat(20)}</p>
    <p>
      Sourced from <a href="https://en.wikipedia.org/wiki/Widget">Wikipedia</a>,
      <a href="https://www.reuters.com/story">Reuters</a>, and
      <a href="https://en.wikipedia.org/wiki/Gadget">Wikipedia again</a>.
      See our <a href="/about">about page</a> and <a href="mailto:hi@acme.test">email us</a>.
    </p>
    <ul><li>Durable</li><li>Affordable</li><li>Fast</li></ul>
    <table><tbody><tr><td>Model</td><td>Price</td></tr></tbody></table>
    <blockquote>"These widgets changed our operations," said an expert.</blockquote>
    <img src="/widget.png" alt="A durable widget" />
    <time datetime="2019-05-05T00:00:00Z">May 2019</time>
  </body>
</html>`;

// A JS-shell page: almost no server-rendered body text.
const SHELL_HTML = `<!doctype html>
<html lang="en">
  <head><title>Loading</title></head>
  <body><div id="root"></div></body>
</html>`;

let browser: Browser;

beforeAll(async () => {
  browser = await chromium.launch({ headless: true });
}, 60000);

afterAll(async () => {
  await browser?.close();
});

/** Build a hermetic (offline) context that fulfills every request from fixtures. */
async function routedContext(
  handle: (url: string, route: Route) => Promise<boolean>,
  mainHtml: string = HTML,
): Promise<BrowserContext> {
  const context = await browser.newContext();
  await context.route("**/*", async (route) => {
    const url = route.request().url();
    const handled = await handle(url, route);
    if (handled) return;
    await route.fulfill({
      status: 200,
      contentType: "text/html",
      headers: { "last-modified": "Wed, 21 Oct 2015 07:28:00 GMT" },
      body: mainHtml,
    });
  });
  return context;
}

const allowRobots = (body: string) => async (url: string, route: Route) => {
  if (url.endsWith("/robots.txt")) {
    await route.fulfill({ status: 200, contentType: "text/plain", body });
    return true;
  }
  if (url.endsWith("/llms.txt")) {
    await route.fulfill({ status: 200, contentType: "text/plain", body: "# Acme\n" });
    return true;
  }
  return false;
};

describe("crawl", () => {
  it("turns a live URL into a fully-populated CrawledPage", async () => {
    const context = await routedContext(allowRobots("User-agent: *\nDisallow:\n"));

    try {
      const page = await crawl("http://acme.test/", { context, ...offline });

      expect(page.url).toBe("http://acme.test/");
      expect(page.statusCode).toBe(200);
      expect(page.title).toBe("Acme Widgets");
      expect(page.metaDescription).toBe("We build the best widgets.");
      // Exact ordered headings (catches ordering/level regressions).
      expect(page.headings).toEqual([
        { level: 1, text: "Welcome to Acme" },
        { level: 2, text: "Our Products" },
        { level: 3, text: "Widgets" },
      ]);
      // JSON-LD flattening: top-level array + @graph array, malformed block skipped.
      const types = page.jsonLdBlocks.map((b) => (b as { "@type"?: string })["@type"]);
      expect(types).toEqual(
        expect.arrayContaining(["Organization", "WebSite", "BreadcrumbList", "Product"]),
      );
      expect(page.jsonLdBlocks).toContainEqual(
        expect.objectContaining({ "@type": "Organization", name: "Acme" }),
      );
      // The malformed block contributes nothing (4 valid entries total).
      expect(page.jsonLdBlocks).toHaveLength(4);
      expect(page.wordCount).toBeGreaterThan(0);
      expect(page.hasServerRenderedContent).toBe(true);
      expect(page.robotsAllowsAiBots).toBe(true);
      expect(page.hasLlmsTxt).toBe(true);
      expect(page.metaAuthor).toBe("Jane Doe");
      // Structure & on-page signals extracted for scoring.
      expect(page.listCount).toBe(1);
      expect(page.listItemCount).toBe(3);
      expect(page.tableCount).toBe(1);
      expect(page.blockquoteCount).toBe(1);
      expect(page.paragraphCount).toBeGreaterThanOrEqual(2);
      expect(page.internalLinkCount).toBe(1); // /about (mailto + externals excluded)
      expect(page.hasAboutOrContactLink).toBe(true);
      expect(page.imageCount).toBe(1);
      expect(page.imagesWithAlt).toBe(1);
      expect(page.hasViewportMeta).toBe(true);
      expect(page.hasCanonical).toBe(true);
      expect(page.hasOpenGraph).toBe(true);
      expect(page.htmlLang).toBe("en");
      // External links only, deduped; same-origin and non-http hrefs dropped.
      expect(page.outboundLinks.sort()).toEqual([
        "https://en.wikipedia.org/wiki/Gadget",
        "https://en.wikipedia.org/wiki/Widget",
        "https://www.reuters.com/story",
      ]);
      expect(typeof page.lastModified).toBe("string");
      expect(new Date(page.lastModified as string).toISOString()).toBe(page.lastModified);
      // Precedence: the meta tag (2024) beats <time> (2019) and the
      // Last-Modified header (2015) the fixture also sends.
      expect(page.lastModifiedSource).toBe("meta");
      expect(page.lastModified).toBe("2024-03-01T00:00:00.000Z");
      expect(typeof page.fetchedAt).toBe("string");
      // Raw served markup is preserved.
      expect(page.html).toContain("<h1>Welcome to Acme</h1>");
    } finally {
      await context.close();
    }
  }, 30000);

  it("caps stored HTML instead of holding an unbounded body in memory", async () => {
    const hugeHtml =
      `<!doctype html><html><head><title>Huge</title></head><body>` +
      "x".repeat(4_000_000) +
      `</body></html>`;
    const context = await routedContext(allowRobots("User-agent: *\nDisallow:\n"), hugeHtml);
    try {
      const page = await crawl("http://acme.test/", { context, ...offline });
      expect(page.html.length).toBeLessThan(hugeHtml.length);
      expect(page.html.length).toBeLessThanOrEqual(3_000_000);
    } finally {
      await context.close();
    }
  }, 30000);

  it("reports hasServerRenderedContent=false for a near-empty JS shell", async () => {
    const context = await routedContext(
      allowRobots("User-agent: *\nDisallow:\n"),
      SHELL_HTML,
    );
    try {
      const page = await crawl("http://acme.test/", { context, ...offline });
      expect(page.hasServerRenderedContent).toBe(false);
    } finally {
      await context.close();
    }
  }, 30000);

  it("reports robotsAllowsAiBots=false when an AI bot is disallowed from root", async () => {
    const context = await routedContext(async (url, route) => {
      if (url.endsWith("/robots.txt")) {
        await route.fulfill({
          status: 200,
          contentType: "text/plain",
          body: "User-agent: GPTBot\nDisallow: /\n\nUser-agent: *\nDisallow:\n",
        });
        return true;
      }
      if (url.endsWith("/llms.txt")) {
        await route.fulfill({ status: 404, contentType: "text/plain", body: "Not found" });
        return true;
      }
      return false;
    });

    try {
      const page = await crawl("http://acme.test/", { context, ...offline });
      expect(page.robotsAllowsAiBots).toBe(false);
      expect(page.hasLlmsTxt).toBe(false);
    } finally {
      await context.close();
    }
  }, 30000);

  it("evaluates each AI bot independently: a wildcard block still blocks the others", async () => {
    // `*` blocks everything and GPTBot is individually exempted — but ClaudeBot,
    // PerplexityBot, and Google-Extended have no group of their own, so they fall
    // to the wildcard and remain blocked. Per RFC 9309 that's "AI bots blocked".
    const context = await routedContext(
      allowRobots("User-agent: *\nDisallow: /\n\nUser-agent: GPTBot\nDisallow:\n"),
    );
    try {
      const page = await crawl("http://acme.test/", { context, ...offline });
      expect(page.robotsAllowsAiBots).toBe(false);
    } finally {
      await context.close();
    }
  }, 30000);

  it("allows AI bots when the wildcard allows and only a non-AI bot is blocked", async () => {
    // BadBot is blocked, but every AI bot falls to the permissive wildcard group.
    const context = await routedContext(
      allowRobots("User-agent: BadBot\nDisallow: /\n\nUser-agent: *\nDisallow:\n"),
    );
    try {
      const page = await crawl("http://acme.test/", { context, ...offline });
      expect(page.robotsAllowsAiBots).toBe(true);
    } finally {
      await context.close();
    }
  }, 30000);

  it("treats `Disallow: /*` as a full block, like `Disallow: /`", async () => {
    const context = await routedContext(
      allowRobots("User-agent: GPTBot\nDisallow: /*\n"),
    );
    try {
      const page = await crawl("http://acme.test/", { context, ...offline });
      expect(page.robotsAllowsAiBots).toBe(false);
    } finally {
      await context.close();
    }
  }, 30000);

  it("lets an in-group `Allow: /` reopen what `Disallow: /` closed", async () => {
    const context = await routedContext(
      allowRobots("User-agent: GPTBot\nDisallow: /\nAllow: /\n"),
    );
    try {
      const page = await crawl("http://acme.test/", { context, ...offline });
      expect(page.robotsAllowsAiBots).toBe(true);
    } finally {
      await context.close();
    }
  }, 30000);

  it("rejects a soft-404 HTML page masquerading as llms.txt", async () => {
    // SPA catch-all rewrites answer 200 with the app shell for any unknown
    // path, so a bare status check would report this site as having the file.
    const context = await routedContext(async (url, route) => {
      if (url.endsWith("/robots.txt")) {
        await route.fulfill({ status: 200, contentType: "text/plain", body: "" });
        return true;
      }
      if (url.endsWith("/llms.txt")) {
        await route.fulfill({
          status: 200,
          contentType: "text/html",
          body: "<!doctype html><html><body>Page not found</body></html>",
        });
        return true;
      }
      return false;
    });
    try {
      const page = await crawl("http://acme.test/", { context, ...offline });
      expect(page.hasLlmsTxt).toBe(false);
    } finally {
      await context.close();
    }
  }, 30000);

  it("rejects an empty llms.txt", async () => {
    const context = await routedContext(async (url, route) => {
      if (url.endsWith("/robots.txt") || url.endsWith("/llms.txt")) {
        await route.fulfill({
          status: 200,
          contentType: "text/plain",
          body: url.endsWith("/llms.txt") ? "   \n" : "",
        });
        return true;
      }
      return false;
    });
    try {
      const page = await crawl("http://acme.test/", { context, ...offline });
      expect(page.hasLlmsTxt).toBe(false);
    } finally {
      await context.close();
    }
  }, 30000);

  it("identifies itself with the crawler User-Agent on every request", async () => {
    // Capture the UA the server sees for the page and both side-fetches, so a
    // regression to anonymous headless Chrome on any of them is caught.
    const seen = new Map<string, string>();
    const record = (url: string, route: Route) => {
      const path = new URL(url).pathname;
      seen.set(path, route.request().headers()["user-agent"] ?? "");
    };
    const context = await routedContext(async (url, route) => {
      record(url, route);
      if (url.endsWith("/robots.txt")) {
        await route.fulfill({ status: 200, contentType: "text/plain", body: "" });
        return true;
      }
      if (url.endsWith("/llms.txt")) {
        await route.fulfill({ status: 200, contentType: "text/plain", body: "# Acme\n" });
        return true;
      }
      return false; // main page falls through to the default HTML fixture
    });

    try {
      await crawl("http://acme.test/", { context, ...offline });
      const ua = crawlerUserAgent();
      expect(ua).toMatch(/WebindBot/);
      expect(seen.get("/")).toBe(ua);
      expect(seen.get("/robots.txt")).toBe(ua);
      expect(seen.get("/llms.txt")).toBe(ua);
      // Not the stock headless-Chrome identity.
      expect(seen.get("/")).not.toMatch(/HeadlessChrome/);
    } finally {
      await context.close();
    }
  }, 30000);

  /**
   * Redirects cannot be exercised through `context.route`: Playwright invokes a
   * route handler once per navigation and follows 3xx transparently, so hop two
   * is never intercepted. A local server is the only way to test the real path.
   */
  describe("redirect handling", () => {
    let server: Server;
    /** Entry point the visitor supplies. */
    let base: string;
    /** Same server, reached under a different hostname — the redirect target. */
    let inward: string;

    beforeAll(async () => {
      server = createServer((req, res) => {
        if (req.url === "/redirect-inward") {
          // Redirect to a *different host* on the same server, which is what a
          // real SSRF redirect looks like.
          res.writeHead(302, { location: `${inward}/landing` });
          res.end();
          return;
        }
        res.writeHead(200, { "content-type": "text/html" });
        res.end("<html><body><h1>Landed</h1></body></html>");
      });
      await new Promise<void>((resolve) =>
        server.listen(0, "127.0.0.1", resolve),
      );
      const { port } = server.address() as AddressInfo;
      base = `http://127.0.0.1:${port}`;
      inward = `http://localhost:${port}`;
    });

    afterAll(async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    });

    it("refuses a page that redirects to a disallowed address", async () => {
      const context = await browser.newContext();
      try {
        await expect(
          crawl(`${base}/redirect-inward`, {
            context,
            isUrlAllowed: async (u) => new URL(u).hostname !== "localhost",
          }),
        ).rejects.toBeInstanceOf(BlockedUrlError);
      } finally {
        await context.close();
      }
    }, 30000);

    it("allows a redirect that stays within permitted addresses", async () => {
      const context = await browser.newContext();
      try {
        const page = await crawl(`${base}/redirect-inward`, {
          context,
          ...offline,
        });
        expect(page.statusCode).toBe(200);
        expect(page.headings).toEqual([{ level: 1, text: "Landed" }]);
      } finally {
        await context.close();
      }
    }, 30000);
  });

  it("ignores a Last-Modified header that's really the CDN cache's regeneration time", async () => {
    // Verified against almodre.com (fronted by a Cloudways cache): its
    // Last-Modified sat within 3 seconds of Date - Age on every request, i.e.
    // it's stamped at cache regeneration, not content edit. A page with no
    // other date evidence must fall to "no date found", not score as fresh.
    const NO_DATE_HTML = `<!doctype html>
<html><head><title>Static Co</title></head>
<body><h1>Static Co</h1><p>${BODY_TEXT.repeat(20)}</p></body></html>`;

    const context = await browser.newContext();
    await context.route("**/*", async (route) => {
      const url = route.request().url();
      if (url.endsWith("/robots.txt")) {
        await route.fulfill({
          status: 200,
          contentType: "text/plain",
          body: "User-agent: *\nDisallow:\n",
        });
        return;
      }
      if (url.endsWith("/llms.txt")) {
        await route.fulfill({
          status: 200,
          contentType: "text/plain",
          body: "# Static Co\n",
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "text/html",
        headers: {
          date: "Tue, 28 Jul 2026 19:11:27 GMT",
          age: "4359",
          // == date - age: the cache's own regeneration instant.
          "last-modified": "Tue, 28 Jul 2026 17:58:48 GMT",
        },
        body: NO_DATE_HTML,
      });
    });

    try {
      const page = await crawl("http://static.test/", { context, ...offline });
      expect(page.lastModified).toBeNull();
      expect(page.lastModifiedSource).toBeNull();
    } finally {
      await context.close();
    }
  }, 30000);

  describe("redirect chain resolution (resolves out-of-band, before Chromium navigates)", () => {
    it("hands Chromium the final URL directly — never the pre-redirect one", async () => {
      const seen: string[] = [];
      const context = await routedContext(async (url, route) => {
        seen.push(url);
        return allowRobots("User-agent: *\nDisallow:\n")(url, route);
      });
      const fetchImpl: typeof fetch = async (input) => {
        if (String(input) === "http://acme.test/start") {
          return new Response(null, {
            status: 302,
            headers: { location: "http://acme.test/final" },
          });
        }
        return new Response(null, { status: 200 });
      };
      try {
        const page = await crawl("http://acme.test/start", {
          context,
          isUrlAllowed: async () => true,
          fetchImpl,
        });
        expect(page.url).toBe("http://acme.test/final");
        // Chromium's own browser-level requests never included the pre-redirect
        // URL — it navigated straight to the already-resolved destination.
        expect(seen).not.toContain("http://acme.test/start");
        expect(seen.some((u) => u.startsWith("http://acme.test/final"))).toBe(true);
      } finally {
        await context.close();
      }
    }, 30000);

    it("rejects a chain that redirects to a disallowed address before Chromium ever navigates there", async () => {
      const seen: string[] = [];
      const context = await routedContext(async (url, route) => {
        seen.push(url);
        return allowRobots("User-agent: *\nDisallow:\n")(url, route);
      });
      const fetchImpl: typeof fetch = async (input) => {
        if (String(input) === "http://acme.test/start") {
          return new Response(null, {
            status: 302,
            headers: { location: "http://169.254.169.254/latest/meta-data" },
          });
        }
        return new Response(null, { status: 200 });
      };
      // A guard that mirrors what the real SSRF check would decide for this one
      // address — the guard's own correctness (that 169.254.169.254 is blocked)
      // is covered by ssrf.test.ts; this test proves resolveRedirectChain
      // actually consults the guard on the redirect TARGET, not just the entry.
      const isUrlAllowed = async (u: string) => !u.includes("169.254.169.254");

      try {
        await expect(
          crawl("http://acme.test/start", { context, isUrlAllowed, fetchImpl }),
        ).rejects.toThrow(BlockedUrlError);
        // Chromium was never asked to fetch the private address.
        expect(seen.some((u) => u.includes("169.254.169.254"))).toBe(false);
      } finally {
        await context.close();
      }
    }, 30000);

    it("gives up after too many redirect hops", async () => {
      const context = await routedContext(allowRobots("User-agent: *\nDisallow:\n"));
      let hop = 0;
      const fetchImpl: typeof fetch = async () => {
        hop += 1;
        return new Response(null, {
          status: 302,
          headers: { location: `http://acme.test/hop-${hop}` },
        });
      };
      try {
        await expect(
          crawl("http://acme.test/start", {
            context,
            isUrlAllowed: async () => true,
            fetchImpl,
          }),
        ).rejects.toThrow(BlockedUrlError);
      } finally {
        await context.close();
      }
    }, 30000);

    it("falls back to letting Chromium navigate directly when the out-of-band probe itself fails", async () => {
      const context = await routedContext(allowRobots("User-agent: *\nDisallow:\n"));
      const throwingFetch: typeof fetch = async () => {
        throw new Error("probe network error");
      };
      try {
        const page = await crawl("http://acme.test/", {
          context,
          isUrlAllowed: async () => true,
          fetchImpl: throwingFetch,
        });
        expect(page.url).toBe("http://acme.test/");
        expect(page.statusCode).toBe(200);
      } finally {
        await context.close();
      }
    }, 30000);
  });
});

describe("crawlerUserAgent", () => {
  afterEach(() => {
    delete process.env.CRAWLER_USER_AGENT;
  });

  it("defaults to a branded, self-describing token with a contact URL", () => {
    delete process.env.CRAWLER_USER_AGENT;
    const ua = crawlerUserAgent();
    expect(ua).toMatch(/WebindBot/);
    expect(ua).toMatch(/https?:\/\//); // points somewhere operators can look
  });

  it("honors a non-empty env override", () => {
    process.env.CRAWLER_USER_AGENT = "CustomBot/2.0 (+https://example.com)";
    expect(crawlerUserAgent()).toBe("CustomBot/2.0 (+https://example.com)");
  });

  it("ignores a blank override and falls back to the default", () => {
    process.env.CRAWLER_USER_AGENT = "   ";
    expect(crawlerUserAgent()).toMatch(/WebindBot/);
  });
});
