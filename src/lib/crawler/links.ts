/**
 * Link-following helpers for the site scan.
 *
 * A crawled page reports the same-host links it contains; the site assessor
 * uses these to find pages a sitemap doesn't list (or to cover a site with no
 * sitemap at all). These helpers decide which links are worth a crawl and when
 * two URLs are the same page, so link following never re-crawls a page or
 * wanders off the site.
 */

/**
 * Paths ending in these extensions are files, not pages: crawling them wastes
 * a browser slot and produces a meaningless score.
 */
const NON_PAGE_EXTENSIONS = new Set([
  "pdf", "jpg", "jpeg", "png", "gif", "webp", "svg", "avif", "ico", "bmp",
  "mp4", "webm", "mov", "mp3", "wav", "ogg",
  "zip", "gz", "tar", "rar", "7z", "dmg", "exe",
  "css", "js", "mjs", "json", "xml", "txt", "csv", "rss", "atom",
  "doc", "docx", "xls", "xlsx", "ppt", "pptx",
  "woff", "woff2", "ttf", "otf", "eot",
]);

/** The host with any leading `www.` removed, lowercased. */
export function siteHost(hostname: string): string {
  return hostname.toLowerCase().replace(/^www\./, "");
}

/**
 * Identity of a page for dedupe: host (www-insensitive), path without a
 * trailing slash or directory index file, and query. `https://www.acme.com/about/`
 * and `https://acme.com/about` are one page, as are `/` and `/index.html`.
 */
export function pageKey(url: string): string {
  try {
    const u = new URL(url);
    const dir = u.pathname.replace(/\/index\.(?:html?|php)$/i, "/");
    const path = dir.length > 1 ? dir.replace(/\/+$/, "") : dir;
    return `${siteHost(u.hostname)}${path}${u.search}`;
  } catch {
    return url;
  }
}

/**
 * Whether a discovered link should be crawled as part of a scan of `host`
 * (already www-stripped). Only same-site http(s) pages qualify; query-string
 * URLs are skipped because faceted navigation (`?sort=`, `?page=`) would
 * otherwise fill the whole page budget with variants of one listing.
 */
export function isFollowableLink(url: string, host: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return false;
  if (siteHost(u.hostname) !== host) return false;
  if (u.search) return false;
  const ext = /\.([a-z0-9]+)$/i.exec(u.pathname)?.[1]?.toLowerCase();
  return !(ext && NON_PAGE_EXTENSIONS.has(ext));
}

/**
 * Utility and archive pages: worth crawling only once the real pages are
 * done. Carts, logins and account areas say nothing about a site's content;
 * tag/author archives, feeds and deep pagination mostly repeat pages the scan
 * reaches anyway. Demoted by the site scan, never excluded.
 */
const LOW_VALUE_SEGMENT =
  /(?:^|\/)(?:cart|basket|checkout|login|log-in|signin|sign-in|logout|log-out|register|signup|sign-up|account|my-account|wp-admin|wp-login\.php|admin|search|tag|tags|author|feed|rss|cdn-cgi)(?:\/|\.html?|$)/i;
const PAGINATION = /\/page\/\d+\/?$/i;

export function isLowValuePath(url: string): boolean {
  try {
    const { pathname } = new URL(url);
    return LOW_VALUE_SEGMENT.test(pathname) || PAGINATION.test(pathname);
  } catch {
    return false;
  }
}
