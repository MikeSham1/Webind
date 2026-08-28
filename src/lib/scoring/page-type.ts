import type { CrawledPage } from "./types";

/**
 * Page-type classification.
 *
 * Different page types have different jobs, so the same signal shouldn't judge
 * them the same way: a homepage isn't an evidence document and needs no author
 * byline or "last updated" date; an article does. Scoring that treats every URL
 * like a blog post misjudges homepages, product, and category pages — this gives
 * the signals a type to adapt to.
 *
 * Deterministic and offline: JSON-LD @type first (the page's own declaration),
 * then URL shape, then content shape. No external data, no model call.
 */

export type PageType = "homepage" | "article" | "product" | "listing" | "other";

/** Root path ("/" or empty) → the homepage. */
function isRootPage(url: string): boolean {
  try {
    const p = new URL(url).pathname.replace(/\/+$/, "");
    return p === "" || p === "/";
  } catch {
    return false;
  }
}

/** Collect every JSON-LD @type across blocks, recursing into @graph. Lowercased. */
function collectJsonLdTypes(blocks: unknown[]): Set<string> {
  const out = new Set<string>();
  const visit = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    const rec = node as Record<string, unknown>;
    const t = rec["@type"];
    if (typeof t === "string") out.add(t.toLowerCase());
    else if (Array.isArray(t)) t.forEach((x) => typeof x === "string" && out.add(x.toLowerCase()));
    if (Array.isArray(rec["@graph"])) (rec["@graph"] as unknown[]).forEach(visit);
  };
  blocks.forEach(visit);
  return out;
}

const ARTICLE_TYPES = ["article", "blogposting", "newsarticle", "report", "techarticle", "scholarlyarticle"];
const PRODUCT_TYPES = ["product", "offer", "aggregateoffer", "productgroup"];
const LISTING_TYPES = ["collectionpage", "itemlist", "searchresultspage"];

/** URL path segment patterns, checked in order. */
const ARTICLE_PATH = /\/(blog|posts?|articles?|news|guides?|stories|insights?)(\/|$)|\/\d{4}\/\d{2}\//i;
const PRODUCT_PATH = /\/(products?|shop|store|item|p|sku|pricing)(\/|$)/i;
const LISTING_PATH = /\/(category|categories|tag|tags|collections?|topics?|archive)(\/|$)/i;

/**
 * Classify a crawled page. Precedence: homepage (root) → explicit schema type →
 * URL shape → content shape (a bylined long-form page is an article) → other.
 */
export function classifyPageType(page: CrawledPage): PageType {
  if (isRootPage(page.url)) return "homepage";

  const types = collectJsonLdTypes(page.jsonLdBlocks);
  if (ARTICLE_TYPES.some((t) => types.has(t))) return "article";
  if (PRODUCT_TYPES.some((t) => types.has(t))) return "product";
  if (LISTING_TYPES.some((t) => types.has(t))) return "listing";

  const path = (() => {
    try {
      return new URL(page.url).pathname;
    } catch {
      return page.url;
    }
  })();
  if (ARTICLE_PATH.test(path)) return "article";
  if (PRODUCT_PATH.test(path)) return "product";
  if (LISTING_PATH.test(path)) return "listing";

  // A named author on a substantial body of prose reads as an article even
  // without schema or a telltale URL.
  if (page.metaAuthor && page.wordCount >= 400) return "article";

  return "other";
}

/** Human-readable label for the report UI. */
export const PAGE_TYPE_LABEL: Record<PageType, string> = {
  homepage: "Homepage",
  article: "Article",
  product: "Product page",
  listing: "Category / listing",
  other: "Content page",
};
