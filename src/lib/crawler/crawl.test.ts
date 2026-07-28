import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { chromium, type Browser, type BrowserContext, type Route } from "playwright";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { crawl, crawlerUserAgent } from "./crawl";
import { BlockedUrlError } from "./ssrf";

/**
 * These tests are hermetic: every request is fulfilled from a fixture. The real
 * URL guard would resolve `acme.test` against DNS, so it is replaced with one
 * that allows everything unless a test says otherwise.
 */
const offline = { isUrlAllowed: async () => true };

const BODY_TEXT = "Acme builds durable, professional-grade widgets for demanding worksites. ";

const HTML = `<!doctype html>
<html lang="en">
  <head>
    <title>Acme Widgets</title>
    <meta name="description" content="We build the best widgets." />
    <meta name="author" content="Jane Doe" />
    <meta property="article:modified_time" content="2024-03-01T00:00:00Z" />
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

  it("honors most-specific-group-wins: a specific allow overrides a wildcard block", async () => {
    // `*` blocks everything, but GPTBot is explicitly allowed => AI bots allowed.
    const context = await routedContext(
      allowRobots("User-agent: *\nDisallow: /\n\nUser-agent: GPTBot\nDisallow:\n"),
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
