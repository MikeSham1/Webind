import type { CrawledPage } from "../scoring/types";

/**
 * Structured-data extraction: turn a crawled page into a flat record of the
 * machine-readable facts it publishes (schema.org JSON-LD, Open Graph, meta
 * tags, headings) so a site scan can be exported as a dataset.
 *
 * Pure and synchronous. It reads only the CrawledPage the scan already holds,
 * so extraction adds no requests to the site: it inherits the scan's robots.txt
 * compliance, Crawl-delay and page budget. It also reads only what the site
 * deliberately publishes for machines; no scraping of personal data from
 * visible text.
 */

export interface PageData {
  url: string;
  fetchedAt: string;
  statusCode: number;
  title: string | null;
  metaDescription: string | null;
  canonicalUrl: string | null;
  lang: string | null;
  wordCount: number;
  lastModified: string | null;
  h1: string | null;
  h2s: string[];
  /** Every schema.org `@type` declared in the page's JSON-LD, deduped. */
  schemaTypes: string[];
  organization: {
    name: string | null;
    url: string | null;
    logo: string | null;
    telephone: string | null;
    email: string | null;
    address: string | null;
    sameAs: string[];
  } | null;
  product: {
    name: string | null;
    brand: string | null;
    sku: string | null;
    price: string | null;
    currency: string | null;
    availability: string | null;
    rating: string | null;
    reviewCount: string | null;
  } | null;
  article: {
    headline: string | null;
    author: string | null;
    datePublished: string | null;
    dateModified: string | null;
  } | null;
  /** Breadcrumb trail names, in order. */
  breadcrumbs: string[];
  /** Open Graph tags, `og:` prefix removed. */
  openGraph: Record<string, string>;
  internalLinkCount: number;
  outboundLinkCount: number;
  imageCount: number;
}

/** H2s kept per page, so a long page can't bloat the export. */
const MAX_H2S = 20;

type Node = Record<string, unknown>;

const ARTICLE_TYPES = new Set([
  "Article", "NewsArticle", "BlogPosting", "TechArticle", "ScholarlyArticle",
  "Report", "LiveBlogPosting",
]);

/** Organization or one of its many subtypes (LocalBusiness, Restaurant, ...). */
function isOrgType(type: string): boolean {
  return /(Organization|Corporation|Business|Store|Restaurant|Service|NGO)$/.test(type);
}

export function extractPageData(page: CrawledPage): PageData {
  const nodes = collectNodes(page.jsonLdBlocks);
  const typesOf = (n: Node) => asArray(n["@type"]).filter((t): t is string => typeof t === "string");
  const firstOf = (match: (type: string) => boolean) =>
    nodes.find((n) => typesOf(n).some(match)) ?? null;

  const org = firstOf(isOrgType);
  const product = firstOf((t) => t === "Product");
  const article = firstOf((t) => ARTICLE_TYPES.has(t));
  const breadcrumb = firstOf((t) => t === "BreadcrumbList");

  return {
    url: page.url,
    fetchedAt: page.fetchedAt,
    statusCode: page.statusCode,
    title: page.title,
    metaDescription: page.metaDescription,
    canonicalUrl: page.canonicalUrl ?? null,
    lang: page.htmlLang,
    wordCount: page.wordCount,
    lastModified: page.lastModified,
    h1: page.headings.find((h) => h.level === 1)?.text || null,
    h2s: page.headings
      .filter((h) => h.level === 2 && h.text)
      .slice(0, MAX_H2S)
      .map((h) => h.text),
    schemaTypes: [...new Set(nodes.flatMap(typesOf))].sort(),
    organization: org && {
      name: text(org.name),
      url: text(org.url),
      logo: text(org.logo),
      telephone: text(org.telephone) ?? text(field(org.contactPoint, "telephone")),
      email: text(org.email) ?? text(field(org.contactPoint, "email")),
      address: address(org.address),
      sameAs: asArray(org.sameAs).map(text).filter((s): s is string => s !== null),
    },
    product: product && productData(product),
    article: article && {
      headline: text(article.headline) ?? text(article.name),
      author: text(article.author) ?? page.metaAuthor,
      datePublished: text(article.datePublished),
      dateModified: text(article.dateModified),
    },
    breadcrumbs: breadcrumb ? breadcrumbNames(breadcrumb) : [],
    openGraph: page.openGraph ?? {},
    internalLinkCount: page.internalLinkCount,
    outboundLinkCount: page.outboundLinks.length,
    imageCount: page.imageCount,
  };
}

function productData(p: Node): NonNullable<PageData["product"]> {
  // `offers` may be one Offer, a list of them, or an AggregateOffer.
  const offer = asArray(p.offers).find(isNode) ?? null;
  const rating = isNode(p.aggregateRating) ? p.aggregateRating : null;
  return {
    name: text(p.name),
    brand: text(p.brand),
    sku: text(p.sku) ?? text(p.gtin13) ?? text(p.mpn),
    price: offer ? text(offer.price) ?? text(offer.lowPrice) : null,
    currency: offer ? text(offer.priceCurrency) : null,
    // "https://schema.org/InStock" → "InStock"
    availability: offer ? text(offer.availability)?.replace(/^.*\//, "") ?? null : null,
    rating: rating ? text(rating.ratingValue) : null,
    reviewCount: rating ? text(rating.reviewCount) ?? text(rating.ratingCount) : null,
  };
}

function breadcrumbNames(list: Node): string[] {
  return asArray(list.itemListElement)
    .filter(isNode)
    .sort((a, b) => Number(a.position ?? 0) - Number(b.position ?? 0))
    .map((item) => text(item.name) ?? text(field(item.item, "name")))
    .filter((s): s is string => s !== null);
}

function address(v: unknown): string | null {
  if (!isNode(v)) return text(v);
  const parts = [
    v.streetAddress,
    v.addressLocality,
    v.addressRegion,
    v.postalCode,
    v.addressCountry,
  ]
    .map(text)
    .filter((s): s is string => s !== null);
  return parts.length > 0 ? parts.join(", ") : null;
}

/**
 * Every schema.org object in the page, walking nested values, so a Product
 * inside a WebPage's `mainEntity` (or an `@graph`) is found too. Bounded so a
 * pathological block can't blow up the walk.
 */
function collectNodes(blocks: unknown[]): Node[] {
  const out: Node[] = [];
  const walk = (v: unknown, depth: number) => {
    if (depth > 8 || out.length >= 500) return;
    if (Array.isArray(v)) {
      for (const x of v) walk(x, depth + 1);
    } else if (isNode(v)) {
      if (v["@type"] !== undefined) out.push(v);
      for (const x of Object.values(v)) walk(x, depth + 1);
    }
  };
  walk(blocks, 0);
  return out;
}

function isNode(v: unknown): v is Node {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function asArray(v: unknown): unknown[] {
  return v === undefined || v === null ? [] : Array.isArray(v) ? v : [v];
}

function field(v: unknown, key: string): unknown {
  const first = asArray(v).find(isNode);
  return first ? first[key] : undefined;
}

/**
 * A schema.org value as display text: strings and numbers as-is, an entity by
 * its `name` (an author or brand object), a `{ "@value": … }` literal, or an
 * ImageObject by its `url`. First element of a list.
 */
function text(v: unknown): string | null {
  if (Array.isArray(v)) return v.length > 0 ? text(v[0]) : null;
  if (typeof v === "string") return v.trim() || null;
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  if (isNode(v)) return text(v.name) ?? text(v["@value"]) ?? text(v.url);
  return null;
}

// --- Export -------------------------------------------------------------------

/** One CSV row per page; nested values are flattened into named columns. */
const CSV_COLUMNS: [string, (d: PageData) => unknown][] = [
  ["url", (d) => d.url],
  ["status", (d) => d.statusCode],
  ["title", (d) => d.title],
  ["meta_description", (d) => d.metaDescription],
  ["canonical_url", (d) => d.canonicalUrl],
  ["lang", (d) => d.lang],
  ["word_count", (d) => d.wordCount],
  ["last_modified", (d) => d.lastModified],
  ["h1", (d) => d.h1],
  ["h2s", (d) => d.h2s.join(" | ")],
  ["schema_types", (d) => d.schemaTypes.join(" | ")],
  ["org_name", (d) => d.organization?.name],
  ["org_url", (d) => d.organization?.url],
  ["org_telephone", (d) => d.organization?.telephone],
  ["org_email", (d) => d.organization?.email],
  ["org_address", (d) => d.organization?.address],
  ["org_same_as", (d) => d.organization?.sameAs.join(" | ")],
  ["product_name", (d) => d.product?.name],
  ["product_brand", (d) => d.product?.brand],
  ["product_sku", (d) => d.product?.sku],
  ["product_price", (d) => d.product?.price],
  ["product_currency", (d) => d.product?.currency],
  ["product_availability", (d) => d.product?.availability],
  ["product_rating", (d) => d.product?.rating],
  ["product_review_count", (d) => d.product?.reviewCount],
  ["article_headline", (d) => d.article?.headline],
  ["article_author", (d) => d.article?.author],
  ["article_published", (d) => d.article?.datePublished],
  ["article_modified", (d) => d.article?.dateModified],
  ["breadcrumbs", (d) => d.breadcrumbs.join(" > ")],
  ["og_title", (d) => d.openGraph.title],
  ["og_description", (d) => d.openGraph.description],
  ["og_image", (d) => d.openGraph.image],
  ["og_type", (d) => d.openGraph.type],
  ["internal_links", (d) => d.internalLinkCount],
  ["outbound_links", (d) => d.outboundLinkCount],
  ["images", (d) => d.imageCount],
  ["fetched_at", (d) => d.fetchedAt],
];

/**
 * Quote a CSV cell. Values come from third-party pages, so a cell starting
 * with = + - @ (or a tab/CR) is prefixed with ' to stop a spreadsheet from
 * executing it as a formula (CSV injection).
 */
function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function pageDataToCsv(rows: PageData[]): string {
  const lines = [CSV_COLUMNS.map(([name]) => name).join(",")];
  for (const row of rows) {
    lines.push(CSV_COLUMNS.map(([, get]) => csvCell(get(row))).join(","));
  }
  return lines.join("\r\n") + "\r\n";
}
