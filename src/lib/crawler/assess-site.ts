import {
  crawl,
  crawlerUserAgent,
  resolveRedirectChain,
  type OriginProbeCache,
} from "./crawl";
import { discoverSitemapUrls } from "./sitemap";
import { isPublicUrl, normalizeUrl } from "./ssrf";
import { isFollowableLink, isLowValuePath, pageKey, siteHost } from "./links";
import { extractPageData, type PageData } from "./extract-data";
import { crawlDelayFor, isPathAllowed, parseRobotsGroups, productToken } from "./robots";
import { buildReport } from "../scoring/report";
import { logInfo } from "../log";
import type { CrawledPage } from "../scoring/types";

/**
 * Site-wide assessment: discover a site's sitemap, score every page it lists,
 * and roll the per-page reports into a site-level summary (average scores, the
 * weakest pages, and the fixes that recur most across the site).
 *
 * When the sitemap lists fewer pages than the cap (or there is no sitemap),
 * the remaining budget is filled by following internal links from pages
 * already crawled, best-first (see compareQueued): with a small page budget,
 * the order decides which pages get scored at all. Those links come out of
 * crawls we ran anyway, so link following costs no extra fetches beyond the
 * pages it adds.
 *
 * Polite by construction: any page the site's robots.txt disallows for our
 * crawler is skipped (sitemap-listed or not), a `Crawl-delay` drops the scan
 * to one request at a time spaced by that delay, and robots.txt/llms.txt are
 * fetched once per scan rather than once per page.
 *
 * Bounded on every axis — a hard page cap and a small crawl concurrency — so a
 * huge sitemap can't fan out into an unbounded number of browser crawls. Never
 * throws: a page that fails to crawl is recorded as such and excluded from the
 * averages rather than aborting the run.
 */

/** How a page entered the scan. */
export type PageSource = "sitemap" | "entry" | "link";

export interface PageAssessment {
  url: string;
  /** Listed in a sitemap, the URL the user entered, or found by following links. */
  source: PageSource;
  ok: boolean;
  ai: number | null;
  traditional: number | null;
  /** The top few prioritized fixes for this page. */
  topFixes: string[];
  /** Present when the crawl failed. */
  error?: string;
  /** The HTTP status the page answered with, when it loaded at all. */
  httpStatus?: number;
  /** Structured data the page publishes (null when the crawl failed). */
  data: PageData | null;
}

export interface SiteReport {
  /** The origin assessed. */
  origin: string;
  /** Sitemap document URLs that were discovered and parsed. */
  sitemaps: string[];
  /** Per-page results: sitemap pages first, then link-discovered ones in crawl order. */
  pages: PageAssessment[];
  /** Average AI Readiness across pages that scored, or null when none did. */
  averageAi: number | null;
  /** Average Traditional Authority across scored pages, or null. */
  averageTraditional: number | null;
  /** Lowest-scoring pages (by combined score), worst first. */
  weakestPages: PageAssessment[];
  /** Fixes that recur across the most pages, most common first. */
  commonFixes: { fix: string; count: number }[];
  /** True when the sitemap held more pages than the cap allowed. */
  truncated: boolean;
  /** How many of `pages` were found by following links rather than a sitemap. */
  linkDiscovered: number;
  /**
   * Sitemap URLs on the www/bare twin of the site's real host (e.g. the
   * sitemap lists acme.com/x but the site lives on www.acme.com). They're
   * crawled at the real host; the count is reported because it's a sitemap bug
   * worth fixing: those listed URLs often 404 or redirect.
   */
  sitemapHostMismatches: number;
  /** Pages that answered with an HTTP error (4xx/5xx), e.g. broken links. */
  brokenPages: number;
  /** Pages we found but did not crawl because robots.txt disallows them for us. */
  blockedByRobots: number;
  /** The robots.txt `Crawl-delay` (seconds) we honored, or null when none. */
  crawlDelay: number | null;
}

export interface AssessSiteOptions {
  /** Max pages to assess. Default 15. */
  maxPages?: number;
  /** Concurrent crawls (kept ≤ the crawler pool to avoid shedding). Default 3. */
  concurrency?: number;
  /** Injectable crawl, for tests. Defaults to the real crawler. */
  crawlImpl?: typeof crawl;
  /** Injectable discovery, for tests. Defaults to sitemap discovery. */
  discoverImpl?: typeof discoverSitemapUrls;
  /** Injectable fetch, passed through to discovery. */
  fetchImpl?: typeof fetch;
  /** Follow internal links to fill the page budget. Default true. */
  followLinks?: boolean;
  /** Injectable sleep, so tests don't wait out a Crawl-delay. */
  sleepImpl?: (ms: number) => Promise<void>;
  /**
   * Injectable redirect resolution for the entered URL, so tests stay offline.
   * Defaults to crawl.ts's SSRF-checked, hop-by-hop resolver.
   */
  resolveImpl?: (url: string) => Promise<string>;
}

/** Longest `Crawl-delay` we wait out between requests (seconds). */
const MAX_CRAWL_DELAY_S = 10;
/**
 * Total time a scan may spend waiting out a `Crawl-delay`. A long delay shrinks
 * the page budget rather than holding a server action open for minutes.
 */
const MAX_DELAY_BUDGET_S = 60;

/**
 * Most discovered-but-unvisited links held at once. Each crawled page reports
 * up to 500 internal links; this bounds memory on a link-farm site while
 * leaving far more candidates than any scan's page budget.
 */
const MAX_PENDING = 5_000;

/** A page waiting to be crawled. */
interface QueuedPage {
  url: string;
  source: PageSource;
  /** Clicks from where the scan started (sitemap pages and the entry are 0). */
  depth: number;
  /** Discovery order, the final tie-breaker, so ordering is deterministic. */
  order: number;
}

/** How many weakest pages and common fixes to surface. */
const TOP_N = 5;

export async function assessSite(
  siteUrl: string,
  opts: AssessSiteOptions = {},
): Promise<SiteReport> {
  let maxPages = opts.maxPages ?? 15;
  let concurrency = Math.max(1, opts.concurrency ?? 3);
  const sleep = opts.sleepImpl ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const doCrawl = opts.crawlImpl ?? crawl;
  const discover = opts.discoverImpl ?? discoverSitemapUrls;

  // Find where the site actually lives before reading its robots.txt and
  // sitemap. A bare domain that redirects to www (or to https, or another
  // host) often serves neither file itself, so looking them up on the typed
  // address found "no robots.txt" and silently ignored the real rules.
  const typed = normalizeUrl(siteUrl) ?? siteUrl;
  const resolve =
    opts.resolveImpl ??
    ((url: string) =>
      resolveRedirectChain(url, (u) => isPublicUrl(u), crawlerUserAgent(), opts.fetchImpl ?? fetch));
  const normalized = await resolve(typed).catch(() => typed);
  const origin = originOf(normalized);
  if (normalized !== typed) {
    logInfo("assess_site.redirected", { from: typed, to: normalized });
  }

  const discovery = await discover(normalized, {
    maxUrls: maxPages,
    fetchImpl: opts.fetchImpl,
  });

  // robots.txt rules for OUR crawler. No robots.txt (or an unreadable one)
  // means no rules, as RFC 9309 treats a missing file.
  const robotsGroups = discovery.robotsTxt ? parseRobotsGroups(discovery.robotsTxt) : [];
  const botToken = productToken(crawlerUserAgent());
  const robotsAllow = (url: string): boolean => {
    try {
      const u = new URL(url);
      return isPathAllowed(robotsGroups, botToken, `${u.pathname}${u.search}`);
    } catch {
      return false;
    }
  };

  // Crawl-delay: one request at a time, spaced out, with the page budget
  // trimmed so the waiting stays bounded.
  const requestedDelay = crawlDelayFor(robotsGroups, botToken);
  const crawlDelay = requestedDelay === null ? null : Math.min(requestedDelay, MAX_CRAWL_DELAY_S);
  if (crawlDelay !== null) {
    concurrency = 1;
    maxPages = Math.min(maxPages, 1 + Math.floor(MAX_DELAY_BUDGET_S / crawlDelay));
  }

  // A site with no reachable sitemap still deserves an answer: start from the
  // URL the user actually gave us.
  // A sitemap listing the bare domain when the site lives on www (or the
  // reverse) points at URLs that often 404. Crawl the page where it really
  // lives, and report the mismatch rather than scoring an error page.
  let sitemapHostMismatches = 0;
  const onSiteHost = (url: string): string => {
    try {
      const u = new URL(url);
      const real = new URL(origin);
      if (u.hostname !== real.hostname && siteHost(u.hostname) === siteHost(real.hostname)) {
        sitemapHostMismatches++;
        u.protocol = real.protocol;
        u.hostname = real.hostname;
        return u.toString();
      }
    } catch {
      // Unparseable: leave it for the crawl to reject.
    }
    return url;
  };
  const candidates: { url: string; source: PageSource }[] =
    discovery.urls.length > 0
      ? discovery.urls.map((url) => ({ url: onSiteHost(url), source: "sitemap" }))
      : [{ url: normalized, source: "entry" }];
  let order = 0;
  const seeds: QueuedPage[] = candidates
    .filter((c) => robotsAllow(c.url))
    .map((c) => ({ ...c, depth: 0, order: order++ }));
  let blockedByRobots = candidates.length - seeds.length;

  logInfo("assess_site.start", {
    origin,
    sitemaps: discovery.sitemaps.length,
    pages: seeds.length,
  });

  let host: string | null = null;
  try {
    host = siteHost(new URL(origin).hostname);
  } catch {
    // Unparseable origin: still assess the seeds, just don't follow links.
  }
  const followLinks = (opts.followLinks ?? true) && host !== null;

  // Best-first: every crawled page may enqueue the unseen same-site pages it
  // links to, and whenever a crawl slot frees up the most valuable waiting
  // page goes next, until the budget is spent. `seen` covers queued URLs and
  // the post-redirect URLs we actually landed on, so nothing is crawled twice.
  const seen = new Set(candidates.map((s) => pageKey(s.url)));
  // How many crawled pages link to each URL. A page linked from nearly every
  // page is in the site's navigation: one of its most important pages.
  const inLinks = new Map<string, number>();
  const lowValue = new Map<string, boolean>();
  const isLow = (url: string) => {
    let v = lowValue.get(url);
    if (v === undefined) lowValue.set(url, (v = isLowValuePath(url)));
    return v;
  };
  /**
   * Sitemap pages first (the owner listed them on purpose), then real pages
   * before utility/archive ones, then fewest clicks from the start, then the
   * most linked-to. Evaluated when a slot frees up, so in-link counts reflect
   * every page crawled so far.
   */
  const compareQueued = (a: QueuedPage, b: QueuedPage): number =>
    Number(a.source === "link") - Number(b.source === "link") ||
    Number(isLow(a.url)) - Number(isLow(b.url)) ||
    a.depth - b.depth ||
    (inLinks.get(pageKey(b.url)) ?? 0) - (inLinks.get(pageKey(a.url)) ?? 0) ||
    a.order - b.order;

  const originProbeCache: OriginProbeCache = new Map();
  let lastStart = 0;
  const pages = await crawlQueue(seeds, maxPages, concurrency, compareQueued, async (item, enqueue) => {
    if (crawlDelay !== null && lastStart > 0) {
      const wait = lastStart + crawlDelay * 1000 - Date.now();
      if (wait > 0) await sleep(wait);
    }
    lastStart = Date.now();
    const { assessment, crawled } = await assessOne(item, (url) =>
      doCrawl(url, { originProbeCache }),
    );
    if (crawled) {
      seen.add(pageKey(crawled.url));
      if (followLinks) {
        for (const link of crawled.internalLinks ?? []) {
          if (!isFollowableLink(link, host!)) continue;
          const key = pageKey(link);
          inLinks.set(key, (inLinks.get(key) ?? 0) + 1);
          if (seen.has(key)) continue;
          seen.add(key);
          if (!robotsAllow(link)) {
            blockedByRobots++;
            continue;
          }
          enqueue({ url: link, source: "link", depth: item.depth + 1, order: order++ });
        }
      }
    }
    return assessment;
  });

  const linkDiscovered = pages.filter((p) => p.source === "link").length;
  if (linkDiscovered > 0 || blockedByRobots > 0 || crawlDelay !== null) {
    logInfo("assess_site.crawl_scope", {
      origin,
      linkDiscovered,
      blockedByRobots,
      crawlDelay,
    });
  }

  const scored = pages.filter((p) => p.ok && p.ai !== null && p.traditional !== null);

  return {
    origin,
    sitemaps: discovery.sitemaps,
    pages,
    averageAi: average(scored.map((p) => p.ai as number)),
    averageTraditional: average(scored.map((p) => p.traditional as number)),
    weakestPages: [...scored]
      .sort(
        (a, b) =>
          (a.ai! + a.traditional!) - (b.ai! + b.traditional!) ||
          a.url.localeCompare(b.url),
      )
      .slice(0, TOP_N),
    commonFixes: rankCommonFixes(scored),
    truncated: discovery.truncated,
    linkDiscovered,
    sitemapHostMismatches,
    brokenPages: pages.filter((p) => p.httpStatus !== undefined && p.httpStatus >= 400).length,
    blockedByRobots,
    crawlDelay,
  };
}

/**
 * Crawl and score one page, converting any failure into a recorded result.
 * Also hands back the crawled page (when there is one) for link following.
 */
async function assessOne(
  { url, source }: { url: string; source: PageSource },
  doCrawl: (url: string) => Promise<CrawledPage>,
): Promise<{ assessment: PageAssessment; crawled: CrawledPage | null }> {
  try {
    const page = await doCrawl(url);
    if (page.statusCode >= 400) {
      // An error page isn't the page: scoring it would drag the site average
      // down with a "thin content" verdict on a 404. Report it as broken, but
      // still hand it back so links on it (a 404 page's nav) are followed.
      return {
        assessment: {
          url,
          source,
          ok: false,
          ai: null,
          traditional: null,
          topFixes: [],
          error: `HTTP ${page.statusCode}`,
          httpStatus: page.statusCode,
          data: null,
        },
        crawled: page,
      };
    }
    const report = buildReport(page);
    return {
      assessment: {
        url,
        source,
        ok: true,
        ai: report.ai.total,
        traditional: report.traditional.total,
        topFixes: report.prioritizedFixes.slice(0, 3),
        httpStatus: page.statusCode,
        data: extractPageData(page),
      },
      crawled: page,
    };
  } catch (err) {
    return {
      assessment: {
        url,
        source,
        ok: false,
        ai: null,
        traditional: null,
        topFixes: [],
        error: err instanceof Error ? err.message : String(err),
        data: null,
      },
      crawled: null,
    };
  }
}

/** Fixes shared by the most pages, most common first (ties broken by text). */
function rankCommonFixes(
  pages: PageAssessment[],
): { fix: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const p of pages) {
    for (const fix of p.topFixes) {
      counts.set(fix, (counts.get(fix) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .filter(([, count]) => count >= 2) // only "common" — seen on ≥2 pages
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, TOP_N)
    .map(([fix, count]) => ({ fix, count }));
}

function average(nums: number[]): number | null {
  if (nums.length === 0) return null;
  return Math.round(nums.reduce((s, n) => s + n, 0) / nums.length);
}

function originOf(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return url;
  }
}

/**
 * Run `fn` over a growing pool of work with at most `limit` in flight at once,
 * starting at most `budget` items in total. `fn` may `enqueue` more (links
 * found on a page). Whenever a slot frees up, the best waiting item by
 * `compare` starts next: a priority queue, re-ranked at pick time so the
 * order can use what earlier pages revealed. Results come back in start
 * order. Keeps concurrency at or below the crawler's own pool so we never
 * overflow its queue into a busy error.
 *
 * Picking is a linear scan of the pending pool. With at most MAX_PENDING
 * waiting and a budget of tens of pages, that's microseconds per pick next
 * to seconds per crawl, and it lets priorities change after enqueueing,
 * which a heap would need re-sifting for.
 */
async function crawlQueue<T, R>(
  initial: T[],
  budget: number,
  limit: number,
  compare: (a: T, b: T) => number,
  fn: (item: T, enqueue: (item: T) => void) => Promise<R>,
): Promise<R[]> {
  const pending = [...initial];
  const results: R[] = [];
  const enqueue = (item: T) => {
    if (pending.length < MAX_PENDING) pending.push(item);
  };
  let started = 0;
  let active = 0;

  const takeBest = (): T => {
    let best = 0;
    for (let i = 1; i < pending.length; i++) {
      if (compare(pending[i], pending[best]) < 0) best = i;
    }
    return pending.splice(best, 1)[0];
  };

  // A worker idles out when nothing is pending, but a page still in flight
  // can enqueue more. So whenever a page finishes, top the pool back up.
  return new Promise<R[]>((resolve, reject) => {
    const pump = () => {
      while (active < limit && started < budget && pending.length > 0) {
        const i = started++;
        active++;
        fn(takeBest(), enqueue).then(
          (r) => {
            results[i] = r;
            active--;
            pump();
          },
          reject,
        );
      }
      if (active === 0 && (started >= budget || pending.length === 0)) resolve(results);
    };
    pump();
  });
}
