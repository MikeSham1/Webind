import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import type { CrawledPage } from "../scoring/types";

/**
 * Named AI crawler user-agents we care about when deciding whether robots.txt
 * blocks AI access. The `*` wildcard group is applied as a fallback only when a
 * bot has no group naming it specifically (see robotsBlocksAnyAiBot).
 */
const AI_BOT_AGENTS = ["gptbot", "claudebot", "perplexitybot", "google-extended"];

/**
 * Minimum stripped-text length (in chars) of the RAW html for us to consider a
 * page server-rendered rather than a near-empty JS shell.
 */
const SSR_MIN_TEXT_LENGTH = 200;

export interface CrawlOptions {
  /**
   * Test-only injection point. When provided, the crawl runs inside this
   * pre-configured BrowserContext (so tests can intercept every request via
   * `context.route(...)` and stay fully offline). The caller owns the context
   * and is responsible for closing it. For real use, call `crawl(url)` and a
   * headless chromium browser is launched and torn down automatically.
   */
  context?: BrowserContext;
}

/**
 * Crawl a live URL with headless chromium and produce a {@link CrawledPage}.
 * Every field of the contract is populated (see ../scoring/types.ts).
 */
export async function crawl(url: string, opts: CrawlOptions = {}): Promise<CrawledPage> {
  let browser: Browser | undefined;
  let context: BrowserContext;

  if (opts.context) {
    context = opts.context;
  } else {
    // --no-sandbox: containers run as root without sandbox capabilities.
    // --disable-dev-shm-usage: containers have a tiny /dev/shm; without this
    // Chromium can crash under memory pressure (a hard 500, not a caught error).
    browser = await chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    });
    context = await browser.newContext();
  }

  try {
    return await crawlInContext(url, context);
  } finally {
    // Only tear down what we created; an injected context belongs to the caller.
    if (browser) await browser.close();
  }
}

async function crawlInContext(url: string, context: BrowserContext): Promise<CrawledPage> {
  const page = await context.newPage();
  try {
    return await extractPage(url, context, page);
  } finally {
    // Close the main page so pages don't accumulate on a reused injected context.
    await page.close();
  }
}

async function extractPage(
  url: string,
  context: BrowserContext,
  page: Page,
): Promise<CrawledPage> {
  // Bounded so a slow/hanging site fails gracefully (caught upstream → friendly
  // error) instead of tying up the request until a platform timeout.
  const response = await page.goto(url, { waitUntil: "load", timeout: 25000 });
  const statusCode = response ? response.status() : 0;

  // RAW served HTML (pre-JS): what SSR judgement is based on.
  const html = response ? await response.text() : "";
  const lastModified = toIso(response?.headers()["last-modified"] ?? null);

  // Visible text after render.
  const renderedText = await page.innerText("body").catch(() => "");

  const rawTitle = await page.title();
  const title = rawTitle && rawTitle.trim() ? rawTitle : null;

  const metaDescription = await page.evaluate(() => {
    const el = document.querySelector('meta[name="description"]');
    const content = el?.getAttribute("content")?.trim();
    return content ? content : null;
  });

  const headings = await page.evaluate(() => {
    const nodes = Array.from(document.querySelectorAll("h1,h2,h3,h4,h5,h6"));
    return nodes.map((h) => ({
      level: Number(h.tagName.charAt(1)),
      text: (h.textContent ?? "").trim(),
    }));
  });

  const rawJsonLd = await page.evaluate(() =>
    Array.from(document.querySelectorAll('script[type="application/ld+json"]')).map(
      (s) => s.textContent ?? "",
    ),
  );
  const jsonLdBlocks = parseJsonLd(rawJsonLd);

  const wordCount = renderedText.split(/\s+/).filter(Boolean).length;

  // Heuristic: strip tags (and <script>/<style>) from the RAW html and treat it
  // as server-rendered if the remaining visible text exceeds a small threshold.
  // This distinguishes real SSR/SSG output from a near-empty JS-only shell.
  const hasServerRenderedContent = stripTags(html).length > SSR_MIN_TEXT_LENGTH;

  const origin = new URL(url).origin;
  const robotsAllowsAiBots = await checkRobotsAllowsAiBots(context, origin);
  const hasLlmsTxt = await checkHasLlmsTxt(context, origin);

  return {
    url,
    fetchedAt: new Date().toISOString(),
    statusCode,
    html,
    renderedText,
    title,
    metaDescription,
    headings,
    jsonLdBlocks,
    wordCount,
    hasServerRenderedContent,
    robotsAllowsAiBots,
    hasLlmsTxt,
    lastModified,
  };
}

/**
 * Parse each application/ld+json block. Invalid blocks are skipped (never
 * throw). Arrays are flattened; an object carrying an `@graph` array is
 * replaced by that graph's items. Everything else is kept as-is.
 */
function parseJsonLd(rawBlocks: string[]): unknown[] {
  const out: unknown[] = [];
  for (const raw of rawBlocks) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue; // skip malformed block
    }
    if (Array.isArray(parsed)) {
      out.push(...parsed);
    } else if (
      parsed &&
      typeof parsed === "object" &&
      Array.isArray((parsed as Record<string, unknown>)["@graph"])
    ) {
      out.push(...((parsed as Record<string, unknown>)["@graph"] as unknown[]));
    } else {
      out.push(parsed);
    }
  }
  return out;
}

/** Remove scripts/styles/tags and collapse whitespace to approximate visible text. */
function stripTags(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function toIso(header: string | null): string | null {
  if (!header) return null;
  const date = new Date(header);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/**
 * Fetch a same-origin resource via a throwaway page navigation. Page/context
 * routing intercepts navigations (unlike Playwright's APIRequestContext), which
 * keeps tests hermetic. Returns status 0 on network error.
 */
async function fetchViaPage(
  context: BrowserContext,
  url: string,
): Promise<{ status: number; body: string }> {
  const page = await context.newPage();
  try {
    const resp = await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 10000,
    });
    if (!resp) return { status: 0, body: "" };
    const body = await resp.text().catch(() => "");
    return { status: resp.status(), body };
  } catch {
    return { status: 0, body: "" };
  } finally {
    await page.close();
  }
}

async function checkRobotsAllowsAiBots(
  context: BrowserContext,
  origin: string,
): Promise<boolean> {
  const { status, body } = await fetchViaPage(context, `${origin}/robots.txt`);
  // Missing/erroring robots.txt => nothing is disallowed => allowed.
  if (status !== 200) return true;
  return !robotsBlocksAnyAiBot(body, AI_BOT_AGENTS);
}

async function checkHasLlmsTxt(context: BrowserContext, origin: string): Promise<boolean> {
  const { status } = await fetchViaPage(context, `${origin}/llms.txt`);
  return status === 200;
}

interface RobotsGroup {
  agents: string[];
  disallows: string[];
  hasRules: boolean;
}

/** Parse robots.txt into user-agent groups (agents lowercased). */
function parseRobotsGroups(robotsTxt: string): RobotsGroup[] {
  const groups: RobotsGroup[] = [];
  let current: RobotsGroup | null = null;

  for (const rawLine of robotsTxt.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    const field = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();

    if (field === "user-agent") {
      // A user-agent line after rules starts a fresh group.
      if (!current || current.hasRules) {
        current = { agents: [], disallows: [], hasRules: false };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
    } else if (field === "disallow") {
      if (!current) {
        current = { agents: [], disallows: [], hasRules: false };
        groups.push(current);
      }
      current.hasRules = true;
      current.disallows.push(value);
    } else if (field === "allow") {
      if (current) current.hasRules = true;
    }
  }

  return groups;
}

/** True if any group in the list has an exact `Disallow: /` (root) rule. */
function groupsDisallowRoot(groups: RobotsGroup[]): boolean {
  return groups.some((g) => g.disallows.some((d) => d === "/"));
}

/**
 * Most-specific-group-wins. If robots.txt names any of our AI bots specifically,
 * those named groups govern and the `*` wildcard is ignored entirely (a site that
 * blocks all via `*` but then explicitly allows GPTBot is NOT reported as blocked).
 * Only when no AI bot is named at all do we fall back to the `*` group. Returns
 * true only if the effective groups include an exact `Disallow: /` (root block).
 */
function robotsBlocksAnyAiBot(robotsTxt: string, botAgents: string[]): boolean {
  const groups = parseRobotsGroups(robotsTxt);
  const named = new Set(botAgents.map((a) => a.toLowerCase()));

  const specificGroups = groups.filter((g) => g.agents.some((a) => named.has(a)));
  if (specificGroups.length > 0) {
    // At least one AI bot is addressed by name: only its rules count.
    return groupsDisallowRoot(specificGroups);
  }

  // No AI bot named: fall back to the wildcard group.
  const wildcardGroups = groups.filter((g) => g.agents.includes("*"));
  return groupsDisallowRoot(wildcardGroups);
}
