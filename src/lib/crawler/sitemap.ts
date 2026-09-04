import { assertPublicUrl, BlockedUrlError, normalizeUrl } from "./ssrf";

/**
 * Sitemap discovery.
 *
 * Given a site, find the page URLs it publishes in its sitemap(s) so the site
 * assessor can score each one. Sources, in order:
 *   1. `Sitemap:` directives in /robots.txt (the canonical pointer),
 *   2. /sitemap.xml and /sitemap_index.xml as conventional fallbacks.
 *
 * A sitemap can be a `<urlset>` (page URLs) or a `<sitemapindex>` (links to
 * more sitemaps); indexes are followed to a bounded depth. Every URL we fetch
 * is SSRF-guarded, and only same-host page URLs are returned — a sitemap that
 * lists third-party URLs can't make us crawl arbitrary hosts.
 */

/** A `<loc>` block classifies the document that contained it. */
export interface ParsedSitemap {
  kind: "urlset" | "sitemapindex";
  locs: string[];
}

export interface SitemapDiscovery {
  /** Sitemap document URLs that were found and parsed. */
  sitemaps: string[];
  /** Same-host page URLs to assess, deduped and capped at `maxUrls`. */
  urls: string[];
  /** True when more page URLs existed than `maxUrls` allowed. */
  truncated: boolean;
}

export interface DiscoverOptions {
  /** Cap on returned page URLs (each becomes a full crawl). Default 20. */
  maxUrls?: number;
  /** Max sitemap documents to fetch (index fan-out guard). Default 10. */
  maxSitemaps?: number;
  /** Per-fetch timeout in ms. Default 8000. */
  timeoutMs?: number;
  /** Injectable fetch so tests never touch the network. Default global fetch. */
  fetchImpl?: typeof fetch;
}

/** Largest sitemap document we'll read, to bound memory. */
const MAX_SITEMAP_BYTES = 10 * 1024 * 1024; // 10MB

/**
 * Extract `<loc>` values and classify the document. Tolerant of namespace
 * prefixes (`<image:loc>` is ignored — only bare `<loc>`), CDATA, and
 * whitespace. Pure and synchronous.
 */
export function parseSitemap(xml: string): ParsedSitemap {
  const kind = /<sitemapindex[\s>]/i.test(xml) ? "sitemapindex" : "urlset";
  const locs: string[] = [];
  // Match <loc> ... </loc> (not <image:loc> etc.), unwrap optional CDATA.
  const re = /<loc>\s*(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?\s*<\/loc>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const url = decodeXmlEntities(m[1].trim());
    if (url) locs.push(url);
  }
  return { kind, locs };
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

/** Pull `Sitemap:` directives out of a robots.txt body. */
export function sitemapsFromRobots(robotsTxt: string): string[] {
  const out: string[] = [];
  for (const line of robotsTxt.split(/\r?\n/)) {
    const m = /^\s*sitemap:\s*(\S+)/i.exec(line);
    if (m) out.push(m[1].trim());
  }
  return out;
}

/**
 * Discover the same-host page URLs published in a site's sitemap(s).
 * Never throws: on any failure it returns whatever it found (possibly empty).
 */
export async function discoverSitemapUrls(
  siteUrl: string,
  opts: DiscoverOptions = {},
): Promise<SitemapDiscovery> {
  const maxUrls = opts.maxUrls ?? 20;
  const maxSitemaps = opts.maxSitemaps ?? 10;
  const timeoutMs = opts.timeoutMs ?? 8000;
  const doFetch = opts.fetchImpl ?? fetch;

  const normalized = normalizeUrl(siteUrl);
  if (!normalized) return { sitemaps: [], urls: [], truncated: false };

  let origin: string;
  let host: string;
  try {
    const u = new URL(normalized);
    origin = u.origin;
    host = u.hostname.replace(/^www\./, "");
  } catch {
    return { sitemaps: [], urls: [], truncated: false };
  }

  // Seed candidate sitemap documents: robots.txt directives first, then the
  // conventional locations.
  const robots = await fetchText(`${origin}/robots.txt`, doFetch, timeoutMs);
  const seeds = [
    ...(robots ? sitemapsFromRobots(robots) : []),
    `${origin}/sitemap.xml`,
    `${origin}/sitemap_index.xml`,
  ];

  const queue = dedupe(seeds);
  const fetchedSitemaps: string[] = [];
  const seenSitemaps = new Set<string>();
  const pageUrls: string[] = [];
  const seenPages = new Set<string>();
  let truncated = false;

  while (queue.length > 0 && fetchedSitemaps.length < maxSitemaps) {
    const sitemapUrl = queue.shift()!;
    if (seenSitemaps.has(sitemapUrl)) continue;
    seenSitemaps.add(sitemapUrl);

    // Only fetch same-host sitemaps (a sitemap index could point elsewhere).
    if (!sameHost(sitemapUrl, host)) continue;

    const xml = await fetchText(sitemapUrl, doFetch, timeoutMs);
    if (!xml) continue;
    fetchedSitemaps.push(sitemapUrl);

    const parsed = parseSitemap(xml);
    if (parsed.kind === "sitemapindex") {
      for (const loc of parsed.locs) {
        if (!seenSitemaps.has(loc)) queue.push(loc);
      }
      continue;
    }

    for (const loc of parsed.locs) {
      if (!sameHost(loc, host)) continue;
      const clean = stripFragment(loc);
      if (seenPages.has(clean)) continue;
      if (pageUrls.length >= maxUrls) {
        truncated = true;
        break;
      }
      seenPages.add(clean);
      pageUrls.push(clean);
    }
  }

  return { sitemaps: fetchedSitemaps, urls: pageUrls, truncated };
}

// --- helpers ---------------------------------------------------------------

/** SSRF-guarded, size- and time-bounded GET returning body text, or null. */
async function fetchText(
  url: string,
  doFetch: typeof fetch,
  timeoutMs: number,
): Promise<string | null> {
  // Structural + resolved SSRF check before we ever open the connection.
  try {
    await assertPublicUrl(url);
  } catch (err) {
    if (err instanceof BlockedUrlError) return null;
    return null;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await doFetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: { accept: "application/xml,text/xml,text/plain,*/*" },
    });
    if (!resp.ok) return null;
    const body = await resp.text();
    return body.length > MAX_SITEMAP_BYTES ? body.slice(0, MAX_SITEMAP_BYTES) : body;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function sameHost(url: string, host: string): boolean {
  try {
    return new URL(url).hostname.replace(/^www\./, "") === host;
  } catch {
    return false;
  }
}

function stripFragment(url: string): string {
  try {
    const u = new URL(url);
    u.hash = "";
    return u.toString();
  } catch {
    return url;
  }
}

function dedupe(items: string[]): string[] {
  return [...new Set(items)];
}
