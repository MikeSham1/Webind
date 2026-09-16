import type { PageType } from "./page-type";

/** Where a page's modification date was recovered from, in precedence order. */
export type DateSource = "json-ld" | "meta" | "time-element" | "header";

/** Per-crawler robots.txt verdict. `unknown` = robots.txt couldn't be fetched. */
export type CrawlerAccessState = "allowed" | "blocked" | "unknown";

/**
 * robots.txt access, tracked per crawler AND per purpose — because these are
 * genuinely different controls, not one "AI access" bit. Search crawlers govern
 * whether you can be surfaced/cited (OAI-SearchBot → ChatGPT Search,
 * PerplexityBot → Perplexity, Claude-SearchBot → Claude, Googlebot → Google).
 * Training crawlers govern model-training use (GPTBot, ClaudeBot,
 * Google-Extended) and do NOT affect search inclusion or ranking — blocking
 * them is a legitimate publisher choice that must never cost "SEO points".
 */
export interface CrawlerAccess {
  googleSearch: CrawlerAccessState;
  openaiSearch: CrawlerAccessState;
  openaiTraining: CrawlerAccessState;
  anthropicSearch: CrawlerAccessState;
  anthropicTraining: CrawlerAccessState;
  perplexitySearch: CrawlerAccessState;
  geminiTraining: CrawlerAccessState;
}

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
  /**
   * True when no AI *search* crawler (OAI-SearchBot, PerplexityBot,
   * Claude-SearchBot) is blocked in robots.txt — i.e. the page is eligible to
   * be surfaced/cited. Deliberately search-only: blocking training crawlers
   * (GPTBot, ClaudeBot, Google-Extended) does not reduce this. Derived from
   * `crawlerAccess`; kept as a boolean for the scorer and model features.
   */
  robotsAllowsAiBots: boolean;
  /** Full per-crawler, per-purpose robots.txt access (see CrawlerAccess). */
  crawlerAccess: CrawlerAccess;
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
  /** Which version of the weights/signals in scoring/weights.ts produced this report. */
  modelVersion: string;
  /**
   * Detected page type. The scorer adapts expectations to it (a homepage needs
   * no byline, date, or citations the way an article does). Optional so reports
   * saved before this field still deserialize.
   */
  pageType?: PageType;
}

/**
 * A specific, page-grounded recommendation — the richer successor to the terse
 * `prioritizedFixes` strings. Generated by scoring/suggest.ts (Gemini when a key
 * is set, a deterministic page-aware fallback otherwise). Presentation-layer
 * only: it never feeds back into the scores, so it can be regenerated or
 * improved without changing `modelVersion`.
 */
export interface ActionableSuggestion {
  /** The signal this addresses (e.g. "factDensity"); matches SignalScore.key. */
  key: string;
  /** Short imperative headline, specific to this page. */
  title: string;
  /** 2-4 concrete steps grounded in the page's actual content. */
  steps: string[];
  /** One sentence on why it moves AI/search visibility. */
  rationale: string;
  /** Optional copy-ready snippet (a meta tag, JSON-LD, a rewritten heading). */
  example?: string;
  /** True when Gemini expanded this; false for the deterministic fallback. */
  aiGenerated: boolean;
}
