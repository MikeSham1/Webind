import { isPublicUrl, normalizeUrl } from "./ssrf";
import { crawlerUserAgent } from "./crawl";

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
  /**
   * The site's robots.txt body, fetched during discovery anyway, so the site
   * scan can honor it without a second request. Null/absent when unavailable.
   */
  robotsTxt?: string | null;
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
  /**
   * Injectable SSRF check (mirrors crawl.ts's `isUrlAllowed`), so tests don't
   * pay for a real DNS lookup. Defaults to the real public-address check.
   */
  isUrlAllowed?: (url: string) => Promise<boolean>;
}

/** Largest sitemap document we'll read, to bound memory. */
const MAX_SITEMAP_BYTES = 10 * 1024 * 1024; // 10MB

/** Redirect chains longer than this are refused rather than followed forever. */
const MAX_REDIRECT_HOPS = 10;

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
  return (
    s
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&#x([0-9a-f]+);/gi, (_, h) => safeCodePoint(parseInt(h, 16)))
      .replace(/&#(\d+);/g, (_, d) => safeCodePoint(Number(d)))
      // Ampersand LAST, so a nested entity like `&amp;lt;` decodes to the
      // literal text `&lt;`, not to `<` (double-decoding).
      .replace(/&amp;/g, "&")
  );
}

function safeCodePoint(cp: number): string {
  try {
    return String.fromCodePoint(cp);
  } catch {
    return "";
  }
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
  const isUrlAllowed = opts.isUrlAllowed ?? ((u: string) => isPublicUrl(u));

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
  const robots = await fetchText(`${origin}/robots.txt`, doFetch, timeoutMs, isUrlAllowed);
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
  // Count every fetch we ATTEMPT, not just the ones that succeed. Counting
  // successes would let a same-host sitemapindex full of failing <loc>s drain
  // the whole queue — thousands of GETs — while `fetchedSitemaps` never reaches
  // the cap. This is the real fan-out bound.
  let attempts = 0;

  while (queue.length > 0 && attempts < maxSitemaps) {
    const sitemapUrl = queue.shift()!;
    if (seenSitemaps.has(sitemapUrl)) continue;
    seenSitemaps.add(sitemapUrl);

    // Only fetch same-host sitemaps (a sitemap index could point elsewhere).
    if (!sameHost(sitemapUrl, host)) continue;

    attempts += 1;
    const xml = await fetchText(sitemapUrl, doFetch, timeoutMs, isUrlAllowed);
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

    // The result set is full — stop fetching further sitemap documents whose
    // URLs we'd only discard anyway.
    if (truncated) break;
  }

  return { sitemaps: fetchedSitemaps, urls: pageUrls, truncated, robotsTxt: robots };
}

// --- helpers ---------------------------------------------------------------

/**
 * SSRF-guarded, size- and time-bounded GET returning body text, or null.
 *
 * Follows redirects itself, one hop at a time, validating each target before
 * requesting it — `redirect: "follow"` would let a same-origin document (e.g.
 * a robots.txt at a URL that already passed the SSRF check) 302 straight to an
 * internal address, with no chance to check it first. See ssrf.ts and the
 * equivalent resolution in crawl.ts for why every hop needs its own check.
 */
async function fetchText(
  url: string,
  doFetch: typeof fetch,
  timeoutMs: number,
  isUrlAllowed: (url: string) => Promise<boolean>,
): Promise<string | null> {
  let current = url;

  for (let hop = 0; hop < MAX_REDIRECT_HOPS; hop++) {
    if (!(await isUrlAllowed(current))) return null;

    // The timeout covers the whole exchange — the connection AND the body read
    // — so a server that dribbles the body (slowloris) still aborts. Clearing
    // it right after `fetch()` returned would leave the read unbounded.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const resp = await doFetch(current, {
        signal: controller.signal,
        redirect: "manual",
        // Identify ourselves, as the page crawler does, so site operators can
        // recognize (and allow or deny) these requests too.
        headers: {
          accept: "application/xml,text/xml,text/plain,*/*",
          "user-agent": crawlerUserAgent(),
        },
      });

      const isRedirect =
        resp.status >= 300 && resp.status < 400 && resp.status !== 304;
      if (isRedirect) {
        // Drain the redirect's body so undici frees the socket instead of
        // leaking it until GC, then validate the next hop on the next loop.
        await resp.body?.cancel().catch(() => {});
        const location = resp.headers.get("location");
        if (!location) return null;
        current = new URL(location, current).toString();
        continue;
      }

      if (!resp.ok) {
        await resp.body?.cancel().catch(() => {});
        return null;
      }
      // Bound the body WHILE streaming, so a multi-GB response can't be fully
      // buffered into memory before the cap is applied.
      return await readBounded(resp, MAX_SITEMAP_BYTES);
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  return null;
}

/** Read a response body as text, stopping once `maxBytes` have been read. */
async function readBounded(resp: Response, maxBytes: number): Promise<string> {
  const reader = resp.body?.getReader();
  if (!reader) {
    const text = await resp.text();
    return text.length > maxBytes ? text.slice(0, maxBytes) : text;
  }
  const decoder = new TextDecoder();
  let out = "";
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    out += decoder.decode(value, { stream: true });
    if (total >= maxBytes) {
      await reader.cancel().catch(() => {});
      break;
    }
  }
  out += decoder.decode();
  return out;
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
