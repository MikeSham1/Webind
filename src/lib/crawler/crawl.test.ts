import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { chromium, type Browser, type BrowserContext, type Route } from "playwright";
import { crawl } from "./crawl";

const BODY_TEXT = "Acme builds durable, professional-grade widgets for demanding worksites. ";

const HTML = `<!doctype html>
<html lang="en">
  <head>
    <title>Acme Widgets</title>
    <meta name="description" content="We build the best widgets." />
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
      const page = await crawl("http://acme.test/", { context });

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
      expect(typeof page.lastModified).toBe("string");
      expect(new Date(page.lastModified as string).toISOString()).toBe(page.lastModified);
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
      const page = await crawl("http://acme.test/", { context });
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
      const page = await crawl("http://acme.test/", { context });
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
      const page = await crawl("http://acme.test/", { context });
      expect(page.robotsAllowsAiBots).toBe(true);
    } finally {
      await context.close();
    }
  }, 30000);
});
