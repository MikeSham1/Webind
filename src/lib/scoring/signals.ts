import type { CrawledPage, SignalScore } from "./types";
import { AI_WEIGHTS, TRADITIONAL_WEIGHTS } from "./weights";

// --- shared helpers ---------------------------------------------------------

/** Clamp a number into the inclusive [min, max] range. */
function clamp(n: number, min = 0, max = 100): number {
  return Math.min(max, Math.max(min, n));
}

/** Whole days between an ISO timestamp and `now`; null when the date is absent. */
function ageInDays(iso: string | null, now = Date.now()): number | null {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return null;
  return (now - then) / (24 * 60 * 60 * 1000);
}

/** Collect all JSON-LD `@type` values (string or string[]) from parsed blocks. */
function collectJsonLdTypes(blocks: unknown[]): string[] {
  const types: string[] = [];
  for (const block of blocks) {
    if (!block || typeof block !== "object") continue;
    const t = (block as Record<string, unknown>)["@type"];
    if (typeof t === "string") {
      types.push(t);
    } else if (Array.isArray(t)) {
      for (const v of t) if (typeof v === "string") types.push(v);
    }
  }
  return types;
}

/**
 * A signal we deliberately cannot measure yet. Scored `null` so it is excluded
 * from the weighted total AND from `coverage` (see composeScore) rather than
 * being averaged in at a neutral value and flattening the result.
 */
function unmeasured(
  key: string,
  label: string,
  weight: number,
  reason: string,
): SignalScore {
  return { key, label, score: null, weight, reason, fix: null };
}

// --- AI signals -------------------------------------------------------------

export function scoreSchema(page: CrawledPage): SignalScore {
  const wanted = ["Organization", "WebSite"];
  const present = new Set(collectJsonLdTypes(page.jsonLdBlocks));
  const missing = wanted.filter((w) => !present.has(w));
  const allPresent = missing.length === 0;
  const score = Math.round(((wanted.length - missing.length) / wanted.length) * 100);
  return {
    key: "schema",
    label: "Schema Markup",
    score,
    weight: AI_WEIGHTS.schema,
    reason: allPresent
      ? "Organization and WebSite JSON-LD schema present."
      : `Missing JSON-LD schema: ${missing.join(", ")}.`,
    fix: allPresent
      ? null
      : "Add JSON-LD Organization and WebSite schema to the homepage.",
  };
}

export function scoreAiCrawlability(page: CrawledPage): SignalScore {
  let score = 100;
  const problems: string[] = [];
  if (!page.hasServerRenderedContent) {
    score -= 40;
    problems.push("server-render key content");
  }
  if (!page.robotsAllowsAiBots) {
    score -= 30;
    problems.push("unblock AI bots in robots.txt");
  }
  if (!page.hasLlmsTxt) {
    score -= 30;
    problems.push("add an llms.txt file");
  }
  score = clamp(score);
  return {
    key: "aiCrawlability",
    label: "AI Crawlability",
    score,
    weight: AI_WEIGHTS.aiCrawlability,
    reason:
      problems.length === 0
        ? "Server-rendered, AI bots allowed, and llms.txt present."
        : `AI crawlability gaps: ${problems.join("; ")}.`,
    fix:
      problems.length === 0
        ? null
        : `Improve AI crawlability: ${problems.join("; ")}.`,
  };
}

/** Human-readable name for where a date came from, used in the reason text. */
const DATE_SOURCE_LABEL = {
  "json-ld": "JSON-LD dateModified",
  meta: "an article:modified_time meta tag",
  "time-element": "a <time> element",
  header: "the Last-Modified header",
} as const;

/**
 * Score how current the page looks to an answer engine.
 *
 * A page with no machine-readable date at all is a real, actionable deficiency
 * — Perplexity and friends cannot establish recency, so they discount the page
 * — but it is NOT the same as a page known to be years stale. It scores in the
 * middle with a fix that says what to add, rather than the flat 0 it used to
 * get for merely omitting a `Last-Modified` header (which most CDN-fronted and
 * dynamically-rendered sites never send).
 */
const NO_DATE_SCORE = 40;

export function scoreFreshness(page: CrawledPage): SignalScore {
  const age = ageInDays(page.lastModified);

  if (age === null || age < 0) {
    // Missing, unparseable, or future-dated: no usable evidence of recency.
    return {
      key: "freshness",
      label: "Content Freshness",
      score: NO_DATE_SCORE,
      weight: AI_WEIGHTS.freshness,
      reason:
        age !== null
          ? "The page's stated update date is in the future, so it can't be trusted."
          : "No machine-readable publish or update date found, so AI engines can't tell how current this page is.",
      fix:
        "Publish an explicit update date — JSON-LD `dateModified` or an " +
        "`article:modified_time` meta tag — so AI engines can verify recency.",
    };
  }

  const via = page.lastModifiedSource
    ? ` (via ${DATE_SOURCE_LABEL[page.lastModifiedSource]})`
    : "";

  let score: number;
  let reason: string;
  if (age < 90) {
    score = 100;
    reason = `Updated within the last 90 days${via}.`;
  } else if (age < 180) {
    score = 60;
    reason = `Last updated 3-6 months ago${via}.`;
  } else if (age < 365) {
    score = 30;
    reason = `Last updated 6-12 months ago${via}.`;
  } else {
    score = 0;
    reason = `Last updated over a year ago${via}.`;
  }

  return {
    key: "freshness",
    label: "Content Freshness",
    score,
    weight: AI_WEIGHTS.freshness,
    reason,
    fix:
      score < 100
        ? "Update this page; Perplexity decays content in 2-3 months."
        : null,
  };
}

/** Distinct external hosts this page links out to. */
function outboundHostCount(page: CrawledPage): number {
  const hosts = new Set<string>();
  for (const href of page.outboundLinks) {
    try {
      hosts.add(new URL(href).hostname.toLowerCase().replace(/^www\./, ""));
    } catch {
      // Ignore anything that isn't a parseable absolute URL.
    }
  }
  return hosts.size;
}

/**
 * Byline fallback for pages with no author metadata. Deliberately narrower than
 * a bare `\bauthor\b` match, which fired on any footer containing the word.
 */
const BYLINE_RE =
  /\b(?:written by|authored by|author:)\s+[A-Z]|(?:^|[\n.!?]\s*)By\s+[A-Z][a-z]+/m;

/** True when JSON-LD declares an `author` with a usable value. */
function hasJsonLdAuthor(blocks: unknown[]): boolean {
  for (const block of blocks) {
    if (!block || typeof block !== "object") continue;
    const author = (block as Record<string, unknown>).author;
    if (typeof author === "string" && author.trim()) return true;
    if (Array.isArray(author) && author.length > 0) return true;
    if (author && typeof author === "object") return true;
  }
  return false;
}

/** Distinct outbound hosts required before we treat a page as citing sources. */
const MIN_CITED_HOSTS = 2;
/** Word count above which a page counts as in-depth. */
const DEPTH_WORDS = 600;

export function scoreEeat(page: CrawledPage): SignalScore {
  // Authorship: structured metadata first, visible byline as a fallback.
  const hasAuthor =
    Boolean(page.metaAuthor?.trim()) ||
    hasJsonLdAuthor(page.jsonLdBlocks) ||
    BYLINE_RE.test(page.renderedText);

  // Citations: real outbound links to other hosts. The previous check regexed
  // `https?://` out of the *visible text*, which almost no site prints, so this
  // third of the signal was close to always-zero regardless of how well the
  // page actually sourced its claims.
  const citedHosts = outboundHostCount(page);
  const hasCitations = citedHosts >= MIN_CITED_HOSTS;

  const hasDepth = page.wordCount > DEPTH_WORDS;

  const score =
    (hasAuthor ? 34 : 0) + (hasCitations ? 33 : 0) + (hasDepth ? 33 : 0);

  const missing: string[] = [];
  if (!hasAuthor) missing.push("add a visible author byline or author metadata");
  if (!hasCitations)
    missing.push(`link out to at least ${MIN_CITED_HOSTS} authoritative sources`);
  if (!hasDepth) missing.push(`expand the page beyond ${DEPTH_WORDS} words`);

  return {
    key: "eeat",
    label: "E-E-A-T Signals",
    score,
    weight: AI_WEIGHTS.eeat,
    reason:
      missing.length === 0
        ? `Author attribution, ${citedHosts} cited sources, and in-depth content detected.`
        : `Weak E-E-A-T signals: ${missing.join("; ")}.`,
    fix: missing.length === 0 ? null : `Strengthen E-E-A-T: ${missing.join("; ")}.`,
  };
}

export function scoreBrandMentions(page: CrawledPage): SignalScore {
  void page;
  return unmeasured(
    "brandMentions",
    "Brand Mentions",
    AI_WEIGHTS.brandMentions,
    "Not measured from the page itself — filled in by the live AI-citation check when an engine API key is configured.",
  );
}

// --- Traditional signals ----------------------------------------------------

export function scoreTechnicalSeo(page: CrawledPage): SignalScore {
  const h1Count = page.headings.filter((h) => h.level === 1).length;
  const hasTitle = page.title !== null && page.title.trim() !== "";
  const hasMeta =
    page.metaDescription !== null && page.metaDescription.trim() !== "";
  const oneH1 = h1Count === 1;
  const ok200 = page.statusCode === 200;
  const score =
    (hasTitle ? 25 : 0) + (hasMeta ? 25 : 0) + (oneH1 ? 25 : 0) + (ok200 ? 25 : 0);
  const missing: string[] = [];
  if (!hasTitle) missing.push("add a <title>");
  if (!hasMeta) missing.push("add a meta description");
  if (!oneH1) missing.push("use exactly one H1");
  if (!ok200) missing.push("return a 200 status");
  return {
    key: "technicalSeo",
    label: "Technical SEO",
    score,
    weight: TRADITIONAL_WEIGHTS.technicalSeo,
    reason:
      missing.length === 0
        ? "Title, meta description, single H1, and 200 status all present."
        : `Technical SEO issues: ${missing.join("; ")}.`,
    fix: missing.length === 0 ? null : `Fix technical SEO: ${missing.join("; ")}.`,
  };
}

export function scoreContentQuality(page: CrawledPage): SignalScore {
  let score: number;
  if (page.wordCount < 200) score = 20;
  else if (page.wordCount < 600) score = 60;
  else score = 100;
  return {
    key: "contentQuality",
    label: "Content Quality",
    score,
    weight: TRADITIONAL_WEIGHTS.contentQuality,
    reason: `Page has ${page.wordCount} words.`,
    fix:
      score < 100
        ? "Expand the page with more substantive, in-depth content."
        : null,
  };
}

export function scoreTopicalAuthority(page: CrawledPage): SignalScore {
  // MVP proxy: heading breadth + content volume. Placeholder until a
  // multi-page crawl can measure true topical coverage.
  const headingScore = (Math.min(page.headings.length, 10) / 10) * 50;
  const wordScore = (Math.min(page.wordCount, 1500) / 1500) * 50;
  const score = clamp(Math.round(headingScore + wordScore));
  return {
    key: "topicalAuthority",
    label: "Topical Authority",
    score,
    weight: TRADITIONAL_WEIGHTS.topicalAuthority,
    reason: "Proxy from heading structure and content depth (single-page MVP).",
    fix:
      score < 100
        ? "Publish more in-depth, topically-related content to build authority."
        : null,
  };
}

export function scoreBacklinks(page: CrawledPage): SignalScore {
  void page;
  return unmeasured(
    "backlinks",
    "Backlinks",
    TRADITIONAL_WEIGHTS.backlinks,
    "Not measured — requires an off-page backlink index (added in a later phase).",
  );
}

export function scoreEngagement(page: CrawledPage): SignalScore {
  void page;
  return unmeasured(
    "engagement",
    "Engagement",
    TRADITIONAL_WEIGHTS.engagement,
    "Not measured — requires traffic and dwell-time data (added in a later phase).",
  );
}
