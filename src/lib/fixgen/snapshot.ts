import { createHash } from "node:crypto";
import type { CrawledPage } from "../scoring/types";

/**
 * An immutable page snapshot — the exact page state a fix recommendation was
 * based on. Recommendations reference a snapshot, never "the page as it is
 * whenever we look again", so features and evidence can't drift out from under
 * a fix (no temporal leakage). A later crawl is only a drift check.
 */
export interface PageSnapshot {
  /** sha256 of the canonical content fields — the snapshot's identity. */
  contentHash: string;
  capturedAt: string;
  url: string;
  host: string;
  locale: string | null;
  pageType: PageType;
  title: string | null;
  metaDescription: string | null;
  headings: { level: number; text: string }[];
  renderedText: string;
  jsonLdBlocks: unknown[];
  hasCanonical: boolean;
  /** The measured crawler access (search vs training), carried for validators. */
  crawlerAccess: CrawledPage["crawlerAccess"];
}

/** Coarse page type, inferred deterministically. Drives fix applicability. */
export type PageType =
  | "product"
  | "article"
  | "faq"
  | "howto"
  | "localbusiness"
  | "organization"
  | "generic";

function collectJsonLdTypes(blocks: unknown[]): Set<string> {
  const types = new Set<string>();
  const visit = (b: unknown) => {
    if (!b || typeof b !== "object") return;
    const t = (b as Record<string, unknown>)["@type"];
    if (typeof t === "string") types.add(t);
    else if (Array.isArray(t)) for (const v of t) if (typeof v === "string") types.add(v);
    const graph = (b as { "@graph"?: unknown[] })["@graph"];
    if (Array.isArray(graph)) graph.forEach(visit);
  };
  blocks.forEach(visit);
  return types;
}

/** Infer a coarse page type from schema first, then heading cues. */
export function inferPageType(page: CrawledPage): PageType {
  const types = collectJsonLdTypes(page.jsonLdBlocks);
  if (types.has("Product") || types.has("SoftwareApplication")) return "product";
  if (types.has("FAQPage") || types.has("QAPage")) return "faq";
  if (types.has("HowTo") || types.has("Recipe")) return "howto";
  if (types.has("LocalBusiness")) return "localbusiness";
  if (types.has("Article") || types.has("BlogPosting") || types.has("NewsArticle"))
    return "article";
  if (types.has("Organization") || types.has("WebSite")) return "organization";
  // Heading heuristics as a fallback.
  const questions = page.headings.filter((h) => h.text.trim().endsWith("?")).length;
  if (questions >= 3) return "faq";
  return "generic";
}

function hostOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/**
 * Build an immutable snapshot from a fresh crawl. The content hash covers only
 * the fields a fix reasons about, so a byte-identical page always hashes the
 * same regardless of when it was crawled.
 */
export function buildSnapshot(page: CrawledPage): PageSnapshot {
  const canonical = JSON.stringify({
    url: page.url,
    title: page.title,
    metaDescription: page.metaDescription,
    headings: page.headings,
    renderedText: page.renderedText,
    jsonLdBlocks: page.jsonLdBlocks,
    htmlLang: page.htmlLang,
  });
  const contentHash = `sha256:${createHash("sha256").update(canonical).digest("hex")}`;

  return {
    contentHash,
    capturedAt: new Date().toISOString(),
    url: page.url,
    host: hostOf(page.url),
    locale: page.htmlLang,
    pageType: inferPageType(page),
    title: page.title,
    metaDescription: page.metaDescription,
    headings: page.headings,
    renderedText: page.renderedText,
    jsonLdBlocks: page.jsonLdBlocks,
    hasCanonical: page.hasCanonical,
    crawlerAccess: page.crawlerAccess,
  };
}
