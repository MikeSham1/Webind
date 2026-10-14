import type {
  Browser,
  BrowserContext,
  Page,
  Response as PlaywrightResponse,
} from "playwright";
import type {
  CrawledPage,
  CrawlerAccess,
  CrawlerAccessState,
  DateSource,
} from "../scoring/types";
import { crawlSlotStats, getBrowser, withCrawlSlot } from "./browser";
import { BlockedUrlError, assertPublicUrl, isPublicUrl } from "./ssrf";
import { logInfo, logWarn } from "../log";
import { parseRobotsGroups, robotsBlocksBot } from "./robots";

/**
 * The crawlers we resolve robots.txt access for, each tagged with its purpose.
 * `search` crawlers govern whether a page can be surfaced/cited; `training`
 * crawlers govern model-training use only and never affect search inclusion.
 * The `*` wildcard group is the fallback when a bot has no group naming it
 * specifically (see robotsBlocksBot). UAs are lowercased for matching.
 */
const CRAWLERS: {
  key: keyof CrawlerAccess;
  ua: string;
  purpose: "search" | "training";
}[] = [
  { key: "googleSearch", ua: "googlebot", purpose: "search" },
  { key: "openaiSearch", ua: "oai-searchbot", purpose: "search" },
  { key: "openaiTraining", ua: "gptbot", purpose: "training" },
  { key: "anthropicSearch", ua: "claude-searchbot", purpose: "search" },
  { key: "anthropicTraining", ua: "claudebot", purpose: "training" },
  { key: "perplexitySearch", ua: "perplexitybot", purpose: "search" },
  { key: "geminiTraining", ua: "google-extended", purpose: "training" },
];

/** The AI *search* crawlers whose access defines `robotsAllowsAiBots`. */
const AI_SEARCH_KEYS: (keyof CrawlerAccess)[] = [
  "openaiSearch",
  "anthropicSearch",
  "perplexitySearch",
];

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
/** Same cap for the internal links kept for site-scan link following. */
const MAX_INTERNAL_LINKS = 500;
/** Open Graph tags kept per page, and the longest value kept for each. */
const MAX_OG_TAGS = 40;
const MAX_OG_VALUE_CHARS = 1_000;

/**
 * Resource types never downloaded. Scoring reads the DOM, text and layout:
 * image counts and alt text come from the <img> tags, and Core Web Vitals
 * come from PageSpeed field data, not this crawl. Skipping the bytes makes
 * `load` fire far sooner on media-heavy pages and spares the site bandwidth.
 * Stylesheets still load: on-screen text depends on CSS visibility.
 */
const SKIPPED_RESOURCE_TYPES = new Set(["image", "media", "font"]);

/** Redirect hops we'll follow ourselves before giving up. */
const MAX_REDIRECT_HOPS = 10;

/** Hard cap on any response body we read outside the browser (redirect probes). */
const MAX_PROBE_BYTES = 2 * 1024 * 1024; // 2 MB

/**
 * Hard cap on the HTML/rendered-text we keep in memory per crawl. Protects
 * scoring (which regex-scans this repeatedly), Postgres storage (the `report`
 * jsonb column), and the response payload from a pathological page — see the
 * call site for why this can only truncate after the fact, not abort the
 * download itself.
 */
const MAX_STORED_TEXT_CHARS = 3_000_000;
/** robots.txt/llms.txt are small text files by nature; cap generously. */
const MAX_PROBE_TEXT_CHARS = 512_000;

function capText(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) : text;
}

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
  /**
   * Test-only injection point for the out-of-band redirect-chain probe (see
   * {@link resolveRedirectChain}). Defaults to the global `fetch`. Tests inject
   * a stub so redirect resolution never touches the network either.
   */
  fetchImpl?: typeof fetch;
  /**
   * Shares the per-origin robots.txt and llms.txt probes across crawls. A site
   * scan passes one map for the whole run, so a 12-page scan asks the site for
   * those files once instead of once per page.
   */
  originProbeCache?: OriginProbeCache;
  /**
   * Cookies to seed into the browser context before navigating — currently
   * used to carry the site's own preview-gate cookie (see
   * `selfScanGateCookie` in `@/lib/gate`) so a self-scan while the deployment
   * is password-gated reaches the real page instead of the gate's splash
   * page. Harmless to pass for any other crawl: Playwright only attaches a
   * cookie to requests matching its `url`/domain.
   */
  cookies?: { name: string; value: string; url: string }[];
}

/** Per-origin results that don't change from page to page within one run. */
export type OriginProbeCache = Map<
  string,
  Promise<{ crawlerAccess: CrawlerAccess; hasLlmsTxt: boolean }>
>;

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
  const fetchImpl = opts.fetchImpl ?? fetch;

  // An injected context means a test harness already owns admission control and
  // browser lifecycle; only the real path takes a slot on the shared browser.
  if (opts.context) {
    if (opts.cookies?.length) await opts.context.addCookies(opts.cookies);
    return crawlInContext(url, opts.context, isUrlAllowed, fetchImpl, opts.originProbeCache);
  }

  // Fail fast with a precise message before spending a browser slot.
  await assertPublicUrl(url);

  const queuedAt = Date.now();
  const statsAtEnqueue = crawlSlotStats();
  logInfo("crawl.enqueue", {
    active: statsAtEnqueue.active,
    queued: statsAtEnqueue.queued,
  });

  return withCrawlSlot(async () => {
    const waitMs = Date.now() - queuedAt;
    const startedAt = Date.now();
    const browser: Browser = await getBrowser();
    // Block service workers: with request interception as a security boundary
    // (the SSRF guard routes every request), a service worker could serve or
    // reissue requests outside that path. Per Playwright's guidance.
    const context = await browser.newContext({ serviceWorkers: "block" });
    try {
      if (opts.cookies?.length) await context.addCookies(opts.cookies);
      const page = await crawlInContext(
        url,
        context,
        isUrlAllowed,
        fetchImpl,
        opts.originProbeCache,
      );
      logInfo("crawl.ok", {
        waitMs,
        durationMs: Date.now() - startedAt,
        statusCode: page.statusCode,
      });
      return page;
    } catch (err) {
      logWarn("crawl.error", {
        waitMs,
        durationMs: Date.now() - startedAt,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
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
  fetchImpl: typeof fetch,
  originProbeCache?: OriginProbeCache,
): Promise<CrawledPage> {
  // Subresources are memoized per origin (cheap, and the SSRF verdict depends
  // only on the host). The navigation chain is deliberately NOT memoized: it is
  // a handful of URLs on the path that matters most, and caching there would
  // silently weaken any guard that inspects more than the origin.
  await installUrlGuard(context, memoizedGuard(isUrlAllowed));

  const page = await context.newPage();
  try {
    return await extractPage(url, context, page, isUrlAllowed, fetchImpl, originProbeCache);
  } finally {
    // Close the main page so pages don't accumulate on a reused injected context.
    await page.close();
  }
}

/**
 * Resolve a URL's redirect chain OURSELVES — entirely outside the browser —
 * validating each hop before following it, and hand Chromium only the final,
 * already-validated destination to navigate to directly.
 *
 * This closes a real gap: Playwright's route interception fires once per
 * top-level navigation, not once per redirect hop — Chromium follows a 3xx
 * chain internally at the network layer before any route handler runs again
 * (confirmed against a live redirecting server: hop two never reaches
 * `installUrlGuard`'s handler). `assertNavigationAllowed` below still checks
 * the chain after the fact as a backstop, but by then Chromium has already
 * made the request. Resolving here first means an internal address is never
 * contacted by Chromium at all — only by this throwaway out-of-band probe,
 * whose response body we discard without exposing anything about it.
 *
 * Uses a plain `fetch` (Node's own, not Chromium's) so it can run before a
 * browser slot is even taken. `redirect: "manual"` on Node's fetch — unlike a
 * browser's, which returns an opaque, unreadable response — returns the real
 * 3xx status and a readable `Location` header, which is what makes this
 * possible (verified empirically, not assumed).
 */
export async function resolveRedirectChain(
  startUrl: string,
  allowed: (url: string) => Promise<boolean>,
  userAgent: string,
  fetchImpl: typeof fetch,
): Promise<string> {
  let current = startUrl;

  for (let hop = 0; hop < MAX_REDIRECT_HOPS; hop++) {
    if (!(await allowed(current))) {
      throw new BlockedUrlError(
        hop === 0
          ? "That doesn't look like a public website."
          : "That site redirects to a private or reserved network address.",
      );
    }

    let res: Response;
    try {
      res = await fetchImpl(current, {
        method: "GET",
        redirect: "manual",
        headers: { "user-agent": userAgent },
        signal: AbortSignal.timeout(AUX_TIMEOUT_MS),
      });
    } catch {
      // The out-of-band probe itself failed (network hiccup, a server that
      // mishandles this exact request shape, etc). `current` was already
      // validated above, so it's safe to hand to Chromium as-is — the
      // post-navigation check remains as a backstop for whatever happens next.
      return current;
    }

    await drainResponseBody(res);

    const isRedirect = res.status >= 300 && res.status < 400 && res.status !== 304;
    if (!isRedirect) return current; // this is the destination

    const location = res.headers.get("location");
    if (!location) return current; // redirect with nowhere to go — let Chromium sort it out

    let next: URL;
    try {
      next = new URL(location, current);
    } catch {
      throw new BlockedUrlError("That site redirected to an invalid address.");
    }
    if (next.protocol !== "http:" && next.protocol !== "https:") {
      throw new BlockedUrlError("That site redirected to a non-web address.");
    }
    current = next.toString();
  }

  throw new BlockedUrlError("That site redirected too many times.");
}

/** Discard a response body without buffering more than a small cap into memory. */
async function drainResponseBody(res: Response): Promise<void> {
  if (!res.body) return;
  const reader = res.body.getReader();
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      total += value?.byteLength ?? 0;
      if (total > MAX_PROBE_BYTES) {
        await reader.cancel().catch(() => {});
        return;
      }
    }
  } catch {
    // Ignore read errors — this body is being discarded regardless.
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
 * The single egress point for every request the crawler makes. It does three
 * things at that choke point: skips media the scorer never reads (see
 * SKIPPED_RESOURCE_TYPES), refuses disallowed hosts, and stamps the crawler's
 * identity onto the requests it does allow.
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
    if (SKIPPED_RESOURCE_TYPES.has(route.request().resourceType())) {
      await route.abort("blockedbyclient");
      return;
    }
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
  response: PlaywrightResponse | null,
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
  fetchImpl: typeof fetch,
  originProbeCache?: OriginProbeCache,
): Promise<CrawledPage> {
  // Resolve any redirect chain ourselves first, so Chromium is only ever asked
  // to navigate to an already-validated destination (see resolveRedirectChain).
  const resolvedUrl = await resolveRedirectChain(
    url,
    allowed,
    crawlerUserAgent(),
    fetchImpl,
  );

  // Bounded so a slow/hanging site fails gracefully (caught upstream → friendly
  // error) instead of tying up the request until a platform timeout.
  const response = await page.goto(resolvedUrl, {
    waitUntil: "load",
    timeout: NAV_TIMEOUT_MS,
  });
  await assertNavigationAllowed(page, response, allowed);

  const statusCode = response ? response.status() : 0;

  // RAW served HTML (pre-JS): what SSR judgement is based on. Capped: Playwright
  // buffers a navigation's body before we can inspect it (no streaming hook for
  // a page load), so this can't abort an oversized download mid-flight — but it
  // does stop a pathological response from ever propagating into scoring,
  // Postgres storage, or the JSON sent back to the client. NAV_TIMEOUT_MS plus
  // the crawl concurrency/queue caps (browser.ts) are what bound the download
  // itself.
  const html = response ? capText(await response.text(), MAX_STORED_TEXT_CHARS) : "";
  const responseHeaders = response?.headers() ?? {};
  const headerDate = isCacheRegenerationArtifact(responseHeaders)
    ? null
    : toIso(responseHeaders["last-modified"] ?? null);

  // Visible text after render.
  const renderedText = capText(
    await page.innerText("body").catch(() => ""),
    MAX_STORED_TEXT_CHARS,
  );

  const rawTitle = await page.title();
  const title = rawTitle && rawTitle.trim() ? rawTitle : null;

  const dom = await page.evaluate(
    ({ maxLinks, maxInternalLinks, maxOgTags, maxOgValueChars }) => {
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

      // Links: outbound (other hosts, capped) vs. internal (same host), and
      // whether the page links to an about/contact/team page (a trust signal).
      const here = new URL(location.href);
      const outbound: string[] = [];
      const internal: string[] = [];
      let internalLinkCount = 0;
      let hasAboutOrContactLink = false;
      const trustPath = /(?:^|\/)(about|contact|team|our-story|company)(?:[/?#]|$)/i;
      for (const a of Array.from(document.querySelectorAll("a[href]"))) {
        const href = a.getAttribute("href");
        if (!href) continue;
        let resolved: URL;
        try {
          resolved = new URL(href, location.href);
        } catch {
          continue; // unparseable href
        }
        if (resolved.protocol !== "http:" && resolved.protocol !== "https:") {
          continue;
        }
        if (resolved.hostname === here.hostname) {
          internalLinkCount++;
          if (internal.length < maxInternalLinks) {
            resolved.hash = "";
            internal.push(resolved.toString());
          }
          if (!hasAboutOrContactLink && trustPath.test(resolved.pathname)) {
            hasAboutOrContactLink = true;
          }
        } else if (outbound.length < maxLinks) {
          outbound.push(resolved.toString());
        }
      }

      // Structure the shapes answer engines lift into citations.
      const paras = Array.from(document.querySelectorAll("p"));
      let longParagraphCount = 0;
      for (const p of paras) {
        const words = (p.textContent ?? "").trim().split(/\s+/).filter(Boolean).length;
        if (words > 120) longParagraphCount++;
      }

      const imgs = Array.from(document.querySelectorAll("img"));
      let imagesWithAlt = 0;
      for (const img of imgs) {
        if ((img.getAttribute("alt") ?? "").trim()) imagesWithAlt++;
      }

      // Open Graph values (first occurrence wins), for the data export.
      const openGraph: Record<string, string> = {};
      for (const m of Array.from(document.querySelectorAll('meta[property^="og:"]'))) {
        if (Object.keys(openGraph).length >= maxOgTags) break;
        const key = (m.getAttribute("property") ?? "").slice(3).trim();
        const value = (m.getAttribute("content") ?? "").trim();
        if (key && value && !(key in openGraph)) {
          openGraph[key] = value.slice(0, maxOgValueChars);
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
        internal,
        metaDates,
        timeDates,
        internalLinkCount,
        hasAboutOrContactLink,
        listCount: document.querySelectorAll("ul,ol").length,
        listItemCount: document.querySelectorAll("li").length,
        tableCount: document.querySelectorAll("table").length,
        blockquoteCount: document.querySelectorAll("blockquote").length,
        paragraphCount: paras.length,
        longParagraphCount,
        imageCount: imgs.length,
        imagesWithAlt,
        hasViewportMeta: !!document.querySelector('meta[name="viewport"]'),
        hasCanonical: !!document.querySelector('link[rel="canonical"]'),
        hasOpenGraph: !!document.querySelector('meta[property^="og:"]'),
        openGraph,
        contentWordCount: (() => {
          // Every word in the page's content, including text a visitor must
          // click to reveal (FAQ accordions, tabs, "read more"). Search engines
          // index that text, so counting only on-screen text (innerText) made
          // accordion pages look thin. Text nodes are counted one at a time so
          // adjacent elements never fuse into one word.
          const skip = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "SVG", "CANVAS", "IFRAME"]);
          const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
            acceptNode(node) {
              for (let el = node.parentElement; el; el = el.parentElement) {
                if (skip.has(el.tagName.toUpperCase())) return NodeFilter.FILTER_REJECT;
              }
              return NodeFilter.FILTER_ACCEPT;
            },
          });
          let words = 0;
          for (let n = walker.nextNode(); n; n = walker.nextNode()) {
            words += (n.nodeValue ?? "").split(/\s+/).filter(Boolean).length;
          }
          return words;
        })(),
        canonicalHref: (() => {
          const href = document.querySelector('link[rel="canonical"]')?.getAttribute("href");
          if (!href) return null;
          try {
            return new URL(href, location.href).toString();
          } catch {
            return null;
          }
        })(),
        htmlLang: document.documentElement.getAttribute("lang"),
      };
    },
    {
      maxLinks: MAX_OUTBOUND_LINKS,
      maxInternalLinks: MAX_INTERNAL_LINKS,
      maxOgTags: MAX_OG_TAGS,
      maxOgValueChars: MAX_OG_VALUE_CHARS,
    },
  );

  const jsonLdBlocks = parseJsonLd(dom.jsonLd);
  const outboundLinks = Array.from(new Set(dom.outbound));
  const internalLinks = Array.from(new Set(dom.internal));
  // The larger of the full-content count (includes collapsed sections) and the
  // on-screen count, so a page whose body we couldn't walk never scores lower.
  const wordCount = Math.max(
    dom.contentWordCount,
    renderedText.split(/\s+/).filter(Boolean).length,
  );

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

  // Use the URL we actually landed on (post-redirect) as canonical, so HTTPS
  // scoring, robots.txt, and llms.txt reflect the analyzed page — not the URL
  // the visitor typed before any redirect. Every hop was already SSRF-validated
  // by assertNavigationAllowed above.
  const finalUrl = page.url();
  const origin = new URL(finalUrl).origin;
  let probes = originProbeCache?.get(origin);
  if (!probes) {
    probes = (async () => ({
      crawlerAccess: await checkCrawlerAccess(context, origin),
      hasLlmsTxt: await checkHasLlmsTxt(context, origin),
    }))();
    originProbeCache?.set(origin, probes);
  }
  const { crawlerAccess, hasLlmsTxt } = await probes;
  const robotsAllowsAiBots = aiSearchCrawlersAllowed(crawlerAccess);

  return {
    url: finalUrl,
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
    internalLinks,
    wordCount,
    hasServerRenderedContent,
    robotsAllowsAiBots,
    crawlerAccess,
    hasLlmsTxt,
    lastModified,
    lastModifiedSource,
    listCount: dom.listCount,
    listItemCount: dom.listItemCount,
    tableCount: dom.tableCount,
    blockquoteCount: dom.blockquoteCount,
    paragraphCount: dom.paragraphCount,
    longParagraphCount: dom.longParagraphCount,
    internalLinkCount: dom.internalLinkCount,
    hasAboutOrContactLink: dom.hasAboutOrContactLink,
    imageCount: dom.imageCount,
    imagesWithAlt: dom.imagesWithAlt,
    hasViewportMeta: dom.hasViewportMeta,
    hasCanonical: dom.hasCanonical,
    hasOpenGraph: dom.hasOpenGraph,
    openGraph: dom.openGraph,
    canonicalUrl: dom.canonicalHref,
    htmlLang: dom.htmlLang,
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

/** How close `Last-Modified` must sit to the cache's own creation instant to count as an artifact of it, not real evidence. */
const CACHE_ARTIFACT_TOLERANCE_MS = 60_000;

/**
 * True when a response's `Last-Modified` is really the CDN cache's own
 * regeneration timestamp rather than evidence of the origin content's age.
 *
 * Confirmed against a live site (almodre.com, fronted by a Cloudways cache):
 * `Last-Modified` sat within 3 seconds of `Date - Age` — i.e. the instant the
 * cache last regenerated — so every cache refresh made the page look freshly
 * edited even though nothing on it had changed. `Age` is how long the cache has
 * held the response, so `Date - Age` reconstructs that instant; when
 * `Last-Modified` lands on it too, the two headers are describing the same
 * event and it is not trustworthy freshness evidence.
 */
function isCacheRegenerationArtifact(headers: Record<string, string>): boolean {
  const lastModified = new Date(headers["last-modified"] ?? "").getTime();
  const responseDate = new Date(headers["date"] ?? "").getTime();
  const age = Number(headers["age"]);
  if (Number.isNaN(lastModified) || Number.isNaN(responseDate) || !Number.isFinite(age) || age < 0) {
    return false;
  }
  const cacheCreatedAt = responseDate - age * 1000;
  return Math.abs(lastModified - cacheCreatedAt) < CACHE_ARTIFACT_TOLERANCE_MS;
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
    const body = capText(await resp.text().catch(() => ""), MAX_PROBE_TEXT_CHARS);
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

/**
 * Resolve robots.txt access for every crawler in CRAWLERS, per purpose.
 *  - status 0 (fetch failed/timed out) → "unknown": we genuinely couldn't check.
 *  - a real robots.txt (200, not a soft-404 shell) → per-bot allowed/blocked.
 *  - anything else (404, non-200, soft-404) → no enforceable robots → "allowed".
 */
async function checkCrawlerAccess(
  context: BrowserContext,
  origin: string,
): Promise<CrawlerAccess> {
  const resource = await fetchViaPage(context, `${origin}/robots.txt`);

  const uniform = (state: CrawlerAccessState): CrawlerAccess =>
    Object.fromEntries(CRAWLERS.map((c) => [c.key, state])) as unknown as CrawlerAccess;

  if (resource.status === 0) return uniform("unknown");
  if (resource.status !== 200 || looksLikeHtml(resource)) return uniform("allowed");

  const groups = parseRobotsGroups(resource.body);
  return Object.fromEntries(
    CRAWLERS.map((c) => [
      c.key,
      robotsBlocksBot(groups, c.ua) ? "blocked" : "allowed",
    ]),
  ) as unknown as CrawlerAccess;
}

/** True when no AI *search* crawler is explicitly blocked (unknown ≠ blocked). */
function aiSearchCrawlersAllowed(access: CrawlerAccess): boolean {
  return !AI_SEARCH_KEYS.some((k) => access[k] === "blocked");
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
