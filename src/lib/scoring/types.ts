/** Where a page's modification date was recovered from, in precedence order. */
export type DateSource = "json-ld" | "meta" | "time-element" | "header";

export interface CrawledPage {
  url: string;
  fetchedAt: string; // ISO timestamp
  statusCode: number;
  html: string; // raw HTML as served (pre-JS)
  renderedText: string; // visible text after render
  title: string | null;
  metaDescription: string | null;
  metaAuthor: string | null;
  headings: { level: number; text: string }[];
  jsonLdBlocks: unknown[]; // parsed application/ld+json blocks
  /** Absolute http(s) hrefs pointing at a host other than the page's own. */
  outboundLinks: string[];
  wordCount: number;
  hasServerRenderedContent: boolean;
  robotsAllowsAiBots: boolean;
  hasLlmsTxt: boolean;
  lastModified: string | null; // ISO
  /** Which source `lastModified` came from; null when no date was found. */
  lastModifiedSource: DateSource | null;

  // --- Structure & extractability (what answer engines lift into citations) ---
  /** Number of <ul>/<ol> lists. */
  listCount: number;
  /** Number of <li> items across all lists. */
  listItemCount: number;
  /** Number of <table> elements. */
  tableCount: number;
  /** Number of <blockquote> elements. */
  blockquoteCount: number;
  /** Number of <p> paragraphs. */
  paragraphCount: number;
  /** Paragraphs longer than ~120 words — a readability/extractability drag. */
  longParagraphCount: number;

  // --- On-page technical & trust ---------------------------------------------
  /** Links to pages on the same host (topical-cluster signal). */
  internalLinkCount: number;
  /** Whether the page links to an about/contact/team page (a trust signal). */
  hasAboutOrContactLink: boolean;
  /** Total <img> elements and how many carry non-empty alt text. */
  imageCount: number;
  imagesWithAlt: number;
  /** <meta name="viewport"> present (mobile-friendliness signal). */
  hasViewportMeta: boolean;
  /** <link rel="canonical"> present. */
  hasCanonical: boolean;
  /** Any Open Graph (og:*) meta present. */
  hasOpenGraph: boolean;
  /** The <html lang> attribute, or null. */
  htmlLang: string | null;
}

export interface SignalScore {
  key: string;
  label: string;
  /**
   * 0-100, or `null` when the signal could not be measured at all. A null
   * score is excluded from the weighted total and from the model's coverage,
   * so an unmeasured signal never silently drags a score toward the middle.
   */
  score: number | null;
  weight: number;
  reason: string;
  fix: string | null;
}

export interface AuthorityScore {
  total: number;
  signals: SignalScore[];
  /**
   * Fraction (0-1) of the model's total weight that was actually measured.
   * `total` is renormalized over exactly this much weight, so it always spans
   * the full 0-100 range and stays comparable across sites.
   */
  coverage: number;
}

export interface ReportResult {
  url: string;
  ai: AuthorityScore;
  traditional: AuthorityScore;
  prioritizedFixes: string[];
}
