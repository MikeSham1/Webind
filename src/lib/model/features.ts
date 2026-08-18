import type { CrawledPage } from "../scoring/types";

/**
 * Feature extraction for the Claude-distilled readiness model.
 *
 * A fixed, ordered numeric feature vector derived deterministically from a
 * crawled page — the same structural signals the heuristic scorer reads, but
 * left as RAW values (the trainer standardizes them). The order here is the
 * contract between training and inference: never reorder or remove an entry
 * without retraining and bumping the model version, or the exported weights
 * would line up against the wrong features.
 */
export const FEATURE_NAMES = [
  "wordCount",
  "paragraphCount",
  "longParagraphRatio",
  "headingCount",
  "hasH2",
  "listItemCount",
  "tableCount",
  "blockquoteCount",
  "schemaBlockCount",
  "hasOrgOrWebsiteSchema",
  "hasLlmsTxt",
  "robotsAllowsAiBots",
  "hasServerRenderedContent",
  "internalLinkCount",
  "outboundLinkCount",
  "hasAboutOrContactLink",
  "altRatio",
  "hasCanonical",
  "hasOpenGraph",
  "hasViewportMeta",
  "hasHtmlLang",
  "titleLen",
  "metaDescLen",
  "hasAuthor",
  "hasLastModified",
] as const;

export type FeatureName = (typeof FEATURE_NAMES)[number];

export const FEATURE_COUNT = FEATURE_NAMES.length;

function bool(v: boolean): number {
  return v ? 1 : 0;
}

/** Do the page's JSON-LD blocks declare Organization and/or WebSite? */
function hasOrgOrWebsite(blocks: unknown[]): boolean {
  for (const b of blocks) {
    const t = (b as { "@type"?: string | string[] })?.["@type"];
    const types = Array.isArray(t) ? t : t ? [t] : [];
    for (const type of types) {
      if (type === "Organization" || type === "WebSite") return true;
    }
    // schema.org @graph wrappers hold their nodes one level down.
    const graph = (b as { "@graph"?: unknown[] })?.["@graph"];
    if (Array.isArray(graph) && hasOrgOrWebsite(graph)) return true;
  }
  return false;
}

/**
 * Build the ordered feature vector for a crawled page. Pure and total —
 * every field falls back to a sensible numeric default so a sparse page still
 * produces a full vector.
 */
export function extractFeatures(page: CrawledPage): number[] {
  const paragraphs = page.paragraphCount || 0;
  const images = page.imageCount || 0;

  const byName: Record<FeatureName, number> = {
    wordCount: page.wordCount || 0,
    paragraphCount: paragraphs,
    longParagraphRatio: paragraphs > 0 ? page.longParagraphCount / paragraphs : 0,
    headingCount: page.headings.length,
    hasH2: bool(page.headings.some((h) => h.level === 2)),
    listItemCount: page.listItemCount || 0,
    tableCount: page.tableCount || 0,
    blockquoteCount: page.blockquoteCount || 0,
    schemaBlockCount: page.jsonLdBlocks.length,
    hasOrgOrWebsiteSchema: bool(hasOrgOrWebsite(page.jsonLdBlocks)),
    hasLlmsTxt: bool(page.hasLlmsTxt),
    robotsAllowsAiBots: bool(page.robotsAllowsAiBots),
    hasServerRenderedContent: bool(page.hasServerRenderedContent),
    internalLinkCount: page.internalLinkCount || 0,
    outboundLinkCount: page.outboundLinks.length,
    hasAboutOrContactLink: bool(page.hasAboutOrContactLink),
    // No images is treated as "not an alt-text problem" (ratio 1), matching how
    // the heuristic scorer declines to penalize a page with nothing to caption.
    altRatio: images > 0 ? page.imagesWithAlt / images : 1,
    hasCanonical: bool(page.hasCanonical),
    hasOpenGraph: bool(page.hasOpenGraph),
    hasViewportMeta: bool(page.hasViewportMeta),
    hasHtmlLang: bool(!!page.htmlLang),
    titleLen: page.title?.length ?? 0,
    metaDescLen: page.metaDescription?.length ?? 0,
    hasAuthor: bool(!!page.metaAuthor),
    hasLastModified: bool(!!page.lastModified),
  };

  return FEATURE_NAMES.map((name) => byName[name]);
}
