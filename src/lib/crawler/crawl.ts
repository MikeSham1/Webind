import type { Browser, BrowserContext, Page, Response } from "playwright";
import type { CrawledPage, DateSource } from "../scoring/types";
import { getBrowser, withCrawlSlot } from "./browser";
import { BlockedUrlError, assertPublicUrl, isPublicUrl } from "./ssrf";

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

/** Navigation budget for the page under analysis. */
const NAV_TIMEOUT_MS = 25_000;
/** Tighter budget for the small side-fetches (robots.txt, llms.txt). */
const AUX_TIMEOUT_MS = 10_000;

/** Cap on stored outbound links, so a link-farm page can't balloon the payload. */
const MAX_OUTBOUND_LINKS = 500;

/**
 * How the crawler identifies itself on the wire.
 *
 * A tool that fetches sites on people's behalf should say who it is and where to
 * learn more, so operators see it in their logs and can allow or deny it in
 * robots.txt. The default headless-Chrome UA does neither — it is anonymous and
 * actively misleading, which is a poor look for a product whose whole premise is
 * scoring whether a site welcomes named AI crawlers. The token is deliberately
 * one of the names our own robots.txt check looks for, so a site that opts into
 * AI bots opts this analyzer in too. Override per deployment via env.
 */
const DEFAULT_USER_AGENT =
  "WebindBot/1.0 (+https://webind.design/bot; website authority analyzer)";

export function crawlerUserAgent(): string {
  const override = process.env.CRAWLER_USER_AGENT?.trim();
  return override && override.length > 0 ? override : DEFAULT_USER_AGENT;
}

export interface CrawlOptions {
  /**
   * Test-only injection point. When provided, the crawl runs inside this
   * pre-configured BrowserContext (so tests can intercept every request via
   * `context.route(...)` and stay fully offline). The caller owns the context
   * and is responsible for closing it. For real use, call `crawl(url)` and a
   * context on the shared headless browser is created and torn down for you.
   */
  context?: BrowserContext;
  /**
   * URL guard, applied to the entry URL, every subresource request, and every
   * hop of the navigation's redirect chain. Defaults to the SSRF check in
   * `./ssrf`. Tests inject a stub so they never touch DNS.
   */
  isUrlAllowed?: (url: string) => Promise<boolean>;
}

/**
 * Crawl a live URL with headless chromium and produce a {@link CrawledPage}.
 * Every field of the contract is populated (see ../scoring/types.ts).
 *
 * @throws {BlockedUrlError} when the URL — or anything it redirects to — points
 *   at a private, reserved, or otherwise non-public address.
 * @throws {CrawlerBusyError} when the crawler is already at capacity.
 */
export async function crawl(url: string, opts: CrawlOptions = {}): Promise<CrawledPage> {
  const isUrlAllowed = opts.isUrlAllowed ?? ((u: string) => isPublicUrl(u));

  // An injected context means a test harness already owns admission control and
  // browser lifecycle; only the real path takes a slot on the shared browser.
  if (opts.context) {
    return crawlInContext(url, opts.context, isUrlAllowed);
  }

  // Fail fast with a precise message before spending a browser slot.
  await assertPublicUrl(url);

  return withCrawlSlot(async () => {
    const browser: Browser = await getBrowser();
    const context = await browser.newContext();
    try {
      return await crawlInContext(url, context, isUrlAllowed);
    } finally {
      // Contexts are cheap and disposable; the browser itself is shared.
      await context.close();
    }
  });
}

async function crawlInContext(
  url: string,
  context: BrowserContext,
  isUrlAllowed: (url: string) => Promise<boolean>,
): Promise<CrawledPage> {
  // Subresources are memoized per origin (cheap, and the SSRF verdict depends
  // only on the host). The navigation chain is deliberately NOT memoized: it is
  // a handful of URLs on the path that matters most, and caching there would
  // silently weaken any guard that inspects more than the origin.
  await installUrlGuard(context, memoizedGuard(isUrlAllowed));

  const page = await context.newPage();
  try {
    return await extractPage(url, context, page, isUrlAllowed);
  } finally {
    // Close the main page so pages don't accumulate on a reused injected context.
    await page.close();
  }
}

/**
 * Wrap a guard so each origin is only evaluated once per crawl — a page with a
 * hundred assets then costs one DNS lookup per host rather than one per asset.
 */
function memoizedGuard(
  isUrlAllowed: (url: string) => Promise<boolean>,
): (url: string) => Promise<boolean> {
  const verdicts = new Map<string, Promise<boolean>>();
  return (requestUrl: string) => {
    let origin: string;
    try {
      origin = new URL(requestUrl).origin;
    } catch {
      return Promise.resolve(false);
    }
    let verdict = verdicts.get(origin);
    if (!verdict) {
      verdict = isUrlAllowed(requestUrl);
      verdicts.set(origin, verdict);
    }
    return verdict;
  };
}

/**
 * The single egress point for every request the crawler makes. It does two
 * things at that choke point: refuses disallowed hosts, and stamps the
 * crawler's identity onto the requests it does allow.
 *
 * Vetting an internal host here means one is never contacted for an image,
 * script, or the robots.txt/llms.txt side-fetches. This does NOT cover
 * redirects: Playwright invokes a route handler once per navigation and follows
 * any 3xx transparently, so hop two never reaches this function (verified
 * against a live redirecting server, not assumed). Redirect chains are checked
 * after the fact by {@link assertNavigationAllowed}; the User-Agent is carried
 * across hops by the browser's normal header propagation.
 */
async function installUrlGuard(
  context: BrowserContext,
  allowed: (url: string) => Promise<boolean>,
): Promise<void> {
  const userAgent = crawlerUserAgent();
  await context.route("**/*", async (route) => {
    if (!(await allowed(route.request().url()))) {
      await route.abort("blockedbyclient");
      return;
    }
    // Identify ourselves on every allowed request. Defer to any handler
    // registered earlier (e.g. a test's fixture routes), or to the network when
    // there is none — fallback overrides propagate to both.
    await route.fallback({
      headers: { ...route.request().headers(), "user-agent": userAgent },
    });
  });
}

/**
 * Check the URL we actually landed on, plus every hop that got us there.
 *
 * Honest description of the guarantee: because Chromium follows redirects
 * internally, the request to a private host has already been *made* by the time
 * we see it. What this prevents is the part that matters — we throw before any
 * response is read, scored, persisted, or described back to the visitor, so an
 * internal endpoint cannot be used as an oracle. Preventing the request itself
 * would mean resolving the chain ourselves before navigating, which buys little
 * against a server that answers the two probes differently.
 */
async function assertNavigationAllowed(
  page: Page,
  response: Response | null,
  allowed: (url: string) => Promise<boolean>,
): Promise<void> {
  const urls = new Set<string>([page.url()]);
  let hop = response?.request().redirectedFrom() ?? null;
  while (hop) {
    urls.add(hop.url());
    hop = hop.redirectedFrom();
  }

  for (const url of urls) {
    if (!(await allowed(url))) {
      throw new BlockedUrlError(
        "That site redirects to a private or reserved network address.",
      );
    }
  }
}

async function extractPage(
  url: string,
  context: BrowserContext,
  page: Page,
  allowed: (url: string) => Promise<boolean>,
): Promise<CrawledPage> {
  // Bounded so a slow/hanging site fails gracefully (caught upstream → friendly
  // error) instead of tying up the request until a platform timeout.
  const response = await page.goto(url, {
    waitUntil: "load",
    timeout: NAV_TIMEOUT_MS,
  });
  await assertNavigationAllowed(page, response, allowed);

  const statusCode = response ? response.status() : 0;

  // RAW served HTML (pre-JS): what SSR judgement is based on.
  const html = response ? await response.text() : "";
  const headerDate = toIso(response?.headers()["last-modified"] ?? null);

  // Visible text after render.
  const renderedText = await page.innerText("body").catch(() => "");

  const rawTitle = await page.title();
  const title = rawTitle && rawTitle.trim() ? rawTitle : null;

  const dom = await page.evaluate(
    ({ maxLinks }) => {
      const metaContent = (selector: string): string | null => {
        const el = document.querySelector(selector);
        const content = el?.getAttribute("content")?.trim();
        return content ? content : null;
      };

      const headings = Array.from(
        document.querySelectorAll("h1,h2,h3,h4,h5,h6"),
      ).map((h) => ({
        level: Number(h.tagName.charAt(1)),
        text: (h.textContent ?? "").trim(),
      }));

      const jsonLd = Array.from(
        document.querySelectorAll('script[type="application/ld+json"]'),
      ).map((s) => s.textContent ?? "");

      // Outbound links: absolute http(s) hrefs on a host other than our own.
      const here = new URL(location.href);
      const outbound: string[] = [];
      for (const a of Array.from(document.querySelectorAll("a[href]"))) {
        if (outbound.length >= maxLinks) break;
        const href = a.getAttribute("href");
        if (!href) continue;
        try {
          const resolved = new URL(href, location.href);
          if (resolved.protocol !== "http:" && resolved.protocol !== "https:") {
            continue;
          }
          if (resolved.hostname === here.hostname) continue;
          outbound.push(resolved.toString());
        } catch {
          // Unparseable href — ignore it.
        }
      }

      // Machine-readable dates, most trustworthy source first.
      const metaDates = [
        metaContent('meta[property="article:modified_time"]'),
        metaContent('meta[property="og:updated_time"]'),
        metaContent('meta[name="last-modified"]'),
        metaContent('meta[property="article:published_time"]'),
      ].filter((v): v is string => v !== null);

      const timeDates = Array.from(document.querySelectorAll("time[datetime]"))
        .map((t) => t.getAttribute("datetime") ?? "")
        .filter(Boolean);

      return {
        metaDescription: metaContent('meta[name="description"]'),
        metaAuthor: metaContent('meta[name="author"]'),
        headings,
        jsonLd,
        outbound,
        metaDates,
        timeDates,
      };
    },
    { maxLinks: MAX_OUTBOUND_LINKS },
  );

  const jsonLdBlocks = parseJsonLd(dom.jsonLd);
  const outboundLinks = Array.from(new Set(dom.outbound));
  const wordCount = renderedText.split(/\s+/).filter(Boolean).length;

  const { lastModified, lastModifiedSource } = pickLastModified({
    "json-ld": collectJsonLdDates(jsonLdBlocks),
    meta: dom.metaDates,
    "time-element": dom.timeDates,
    header: headerDate ? [headerDate] : [],
  });

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
    metaDescription: dom.metaDescription,
    metaAuthor: dom.metaAuthor,
    headings: dom.headings,
    jsonLdBlocks,
    outboundLinks,
    wordCount,
    hasServerRenderedContent,
    robotsAllowsAiBots,
    hasLlmsTxt,
    lastModified,
    lastModifiedSource,
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

/** Pull `dateModified` / `datePublished` out of parsed JSON-LD blocks. */
function collectJsonLdDates(blocks: unknown[]): string[] {
  const dates: string[] = [];
  for (const block of blocks) {
    if (!block || typeof block !== "object") continue;
    const record = block as Record<string, unknown>;
    for (const key of ["dateModified", "datePublished"]) {
      const value = record[key];
      if (typeof value === "string" && value.trim()) dates.push(value);
    }
  }
  return dates;
}

/**
 * Choose the page's modification date from every source we found.
 *
 * Sources are consulted in descending order of trustworthiness: a publisher's
 * explicit `dateModified` beats a meta tag, which beats a stray `<time>`, which
 * beats the `Last-Modified` header — the header is last because CDNs and
 * dynamic renderers routinely omit it (which used to zero this signal outright)
 * or set it to deploy time. Within a source, the most recent valid date wins.
 */
function pickLastModified(
  candidates: Record<DateSource, string[]>,
): { lastModified: string | null; lastModifiedSource: DateSource | null } {
  const order: DateSource[] = ["json-ld", "meta", "time-element", "header"];

  for (const source of order) {
    let newest: number | null = null;
    for (const raw of candidates[source]) {
      const time = new Date(raw).getTime();
      if (Number.isNaN(time)) continue;
      if (newest === null || time > newest) newest = time;
    }
    if (newest !== null) {
      return {
        lastModified: new Date(newest).toISOString(),
        lastModifiedSource: source,
      };
    }
  }

  return { lastModified: null, lastModifiedSource: null };
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

interface FetchedResource {
  status: number;
  body: string;
  contentType: string;
}

/**
 * Fetch a same-origin resource via a throwaway page navigation. Page/context
 * routing intercepts navigations (unlike Playwright's APIRequestContext), which
 * keeps tests hermetic. Returns status 0 on network error or timeout.
 */
async function fetchViaPage(
  context: BrowserContext,
  url: string,
): Promise<FetchedResource> {
  const empty: FetchedResource = { status: 0, body: "", contentType: "" };
  const page = await context.newPage();
  try {
    const resp = await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: AUX_TIMEOUT_MS,
    });
    if (!resp) return empty;
    const body = await resp.text().catch(() => "");
    return {
      status: resp.status(),
      body,
      contentType: resp.headers()["content-type"] ?? "",
    };
  } catch {
    return empty;
  } finally {
    await page.close();
  }
}

/**
 * True when a "plain text" fetch actually returned a page of HTML — the classic
 * soft-404. Hosts with an SPA catch-all rewrite answer 200 with their app shell
 * for *any* unknown path, so a bare status check reports every such site as
 * having the file.
 */
function looksLikeHtml(resource: FetchedResource): boolean {
  if (/\bhtml\b/i.test(resource.contentType)) return true;
  return /^\s*(<!doctype\s+html|<html[\s>])/i.test(resource.body);
}

async function checkRobotsAllowsAiBots(
  context: BrowserContext,
  origin: string,
): Promise<boolean> {
  const resource = await fetchViaPage(context, `${origin}/robots.txt`);
  // Missing, erroring, or soft-404'd robots.txt => nothing is disallowed.
  if (resource.status !== 200 || looksLikeHtml(resource)) return true;
  return !robotsBlocksAnyAiBot(resource.body, AI_BOT_AGENTS);
}

async function checkHasLlmsTxt(
  context: BrowserContext,
  origin: string,
): Promise<boolean> {
  const resource = await fetchViaPage(context, `${origin}/llms.txt`);
  if (resource.status !== 200) return false;
  if (looksLikeHtml(resource)) return false;
  return resource.body.trim().length > 0;
}

interface RobotsGroup {
  agents: string[];
  disallows: string[];
  allows: string[];
  hasRules: boolean;
}

/** Parse robots.txt into user-agent groups (agents lowercased). */
function parseRobotsGroups(robotsTxt: string): RobotsGroup[] {
  const groups: RobotsGroup[] = [];
  let current: RobotsGroup | null = null;

  const startGroup = (): RobotsGroup => {
    const group: RobotsGroup = {
      agents: [],
      disallows: [],
      allows: [],
      hasRules: false,
    };
    groups.push(group);
    return group;
  };

  for (const rawLine of robotsTxt.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    const field = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();

    if (field === "user-agent") {
      // A user-agent line after rules starts a fresh group.
      if (!current || current.hasRules) current = startGroup();
      current.agents.push(value.toLowerCase());
    } else if (field === "disallow") {
      if (!current) current = startGroup();
      current.hasRules = true;
      current.disallows.push(value);
    } else if (field === "allow") {
      if (!current) current = startGroup();
      current.hasRules = true;
      current.allows.push(value);
    }
  }

  return groups;
}

/**
 * Paths that close off the whole site. `Disallow: /*` is as common in the wild
 * as `Disallow: /` and means the same thing, so matching only the bare slash
 * read a fully-blocked site as wide open.
 */
const ROOT_PATHS = new Set(["/", "/*"]);

/**
 * True when a group shuts out the entire site. An explicit `Allow:` of the root
 * within the same group re-opens what the `Disallow` closed, which is how sites
 * express "block everything except…" — treating that as a full block was a
 * false positive.
 */
function groupBlocksRoot(group: RobotsGroup): boolean {
  if (!group.disallows.some((d) => ROOT_PATHS.has(d))) return false;
  return !group.allows.some((a) => ROOT_PATHS.has(a));
}

/**
 * Most-specific-group-wins. If robots.txt names any of our AI bots specifically,
 * those named groups govern and the `*` wildcard is ignored entirely (a site that
 * blocks all via `*` but then explicitly allows GPTBot is NOT reported as blocked).
 * Only when no AI bot is named at all do we fall back to the `*` group. Returns
 * true only if the effective groups block the site root.
 */
function robotsBlocksAnyAiBot(robotsTxt: string, botAgents: string[]): boolean {
  const groups = parseRobotsGroups(robotsTxt);
  const named = new Set(botAgents.map((a) => a.toLowerCase()));

  const specificGroups = groups.filter((g) => g.agents.some((a) => named.has(a)));
  if (specificGroups.length > 0) {
    // At least one AI bot is addressed by name: only its rules count.
    return specificGroups.some(groupBlocksRoot);
  }

  // No AI bot named: fall back to the wildcard group.
  return groups.filter((g) => g.agents.includes("*")).some(groupBlocksRoot);
}
