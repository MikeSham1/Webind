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

export function scoreFreshness(page: CrawledPage): SignalScore {
  const age = ageInDays(page.lastModified);
  let score: number;
  let reason: string;
  if (age === null || age < 0) {
    // A missing or future-dated timestamp is not evidence of freshness.
    score = 0;
    reason = "No reliable last-modified date available.";
  } else if (age < 90) {
    score = 100;
    reason = "Updated within the last 90 days.";
  } else if (age < 180) {
    score = 60;
    reason = "Last updated 3-6 months ago.";
  } else if (age < 365) {
    score = 30;
    reason = "Last updated 6-12 months ago.";
  } else {
    score = 0;
    reason = "Last updated over a year ago.";
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

export function scoreEeat(page: CrawledPage): SignalScore {
  // MVP text heuristics: author byline, outbound citations, and content depth.
  // These are intentionally coarse and should be replaced once the crawler
  // emits structured byline / outbound-link fields (see the crawler task).
  const text = page.renderedText;
  // Byline: "By <Capitalized Name>" or an explicit "author"/"authored" word.
  const hasAuthor =
    /\b[Bb]y\s+[A-Z][a-z]+/.test(text) || /\bauthor(ed| by)?\b/i.test(text);
  // Citation: an actual URL, not the bare word "http" in prose.
  const hasCitations = /https?:\/\/\S+/i.test(text);
  const hasDepth = page.wordCount > 600;
  const score =
    (hasAuthor ? 34 : 0) + (hasCitations ? 33 : 0) + (hasDepth ? 33 : 0);
  const missing: string[] = [];
  if (!hasAuthor) missing.push("add a visible author byline");
  if (!hasCitations) missing.push("cite authoritative outbound sources");
  if (!hasDepth) missing.push("expand the page beyond 600 words");
  return {
    key: "eeat",
    label: "E-E-A-T Signals",
    score,
    weight: AI_WEIGHTS.eeat,
    reason:
      missing.length === 0
        ? "Author byline, outbound citations, and in-depth content detected."
        : `Weak E-E-A-T signals: ${missing.join("; ")}.`,
    fix: missing.length === 0 ? null : `Strengthen E-E-A-T: ${missing.join("; ")}.`,
  };
}

export function scoreBrandMentions(page: CrawledPage): SignalScore {
  void page;
  return {
    key: "brandMentions",
    label: "Brand Mentions",
    score: 50,
    weight: AI_WEIGHTS.brandMentions,
    reason: "Neutral placeholder; requires off-page data (added in a later phase).",
    fix: null,
  };
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
  return {
    key: "backlinks",
    label: "Backlinks",
    score: 50,
    weight: TRADITIONAL_WEIGHTS.backlinks,
    reason: "Neutral placeholder; requires off-page data (added in a later phase).",
    fix: null,
  };
}

export function scoreEngagement(page: CrawledPage): SignalScore {
  void page;
  return {
    key: "engagement",
    label: "Engagement",
    score: 50,
    weight: TRADITIONAL_WEIGHTS.engagement,
    reason: "Neutral placeholder; requires off-page data (added in a later phase).",
    fix: null,
  };
}
