import { crawl } from "./crawl";
import { discoverSitemapUrls } from "./sitemap";
import { normalizeUrl } from "./ssrf";
import { buildReport } from "../scoring/report";
import { logInfo } from "../log";
import { selfScanGateCookie } from "../gate";

/**
 * Site-wide assessment: discover a site's sitemap, score every page it lists,
 * and roll the per-page reports into a site-level summary (average scores, the
 * weakest pages, and the fixes that recur most across the site).
 *
 * Bounded on every axis — a hard page cap and a small crawl concurrency — so a
 * huge sitemap can't fan out into an unbounded number of browser crawls. Never
 * throws: a page that fails to crawl is recorded as such and excluded from the
 * averages rather than aborting the run.
 */

export interface PageAssessment {
  url: string;
  ok: boolean;
  ai: number | null;
  traditional: number | null;
  /** The top few prioritized fixes for this page. */
  topFixes: string[];
  /** Present when the crawl failed. */
  error?: string;
}

export interface SiteReport {
  /** The origin assessed. */
  origin: string;
  /** Sitemap document URLs that were discovered and parsed. */
  sitemaps: string[];
  /** Per-page results, in sitemap order. */
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
}

/** How many weakest pages and common fixes to surface. */
const TOP_N = 5;

export async function assessSite(
  siteUrl: string,
  opts: AssessSiteOptions = {},
): Promise<SiteReport> {
  const maxPages = opts.maxPages ?? 15;
  const concurrency = Math.max(1, opts.concurrency ?? 3);
  const doCrawl = opts.crawlImpl ?? crawl;
  const discover = opts.discoverImpl ?? discoverSitemapUrls;

  const normalized = normalizeUrl(siteUrl) ?? siteUrl;
  const origin = originOf(normalized);

  const discovery = await discover(normalized, {
    maxUrls: maxPages,
    fetchImpl: opts.fetchImpl,
  });

  // A site with no reachable sitemap still deserves an answer: assess the URL
  // the user actually gave us.
  const urls = discovery.urls.length > 0 ? discovery.urls : [normalized];

  logInfo("assess_site.start", {
    origin,
    sitemaps: discovery.sitemaps.length,
    pages: urls.length,
  });

  const pages = await mapWithConcurrency(urls, concurrency, (url) =>
    assessOne(url, doCrawl),
  );

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
  };
}

/** Crawl and score one page, converting any failure into a recorded result. */
async function assessOne(
  url: string,
  doCrawl: typeof crawl,
): Promise<PageAssessment> {
  try {
    const gateCookie = await selfScanGateCookie(url);
    const page = await doCrawl(url, { cookies: gateCookie ? [gateCookie] : undefined });
    const report = buildReport(page);
    return {
      url,
      ok: true,
      ai: report.ai.total,
      traditional: report.traditional.total,
      topFixes: report.prioritizedFixes.slice(0, 3),
    };
  } catch (err) {
    return {
      url,
      ok: false,
      ai: null,
      traditional: null,
      topFixes: [],
      error: err instanceof Error ? err.message : String(err),
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
 * Run `fn` over `items` with at most `limit` in flight at once. Preserves input
 * order in the results. Keeps concurrency at or below the crawler's own pool so
 * we never overflow its queue into a busy error.
 */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => worker()),
  );
  return results;
}
