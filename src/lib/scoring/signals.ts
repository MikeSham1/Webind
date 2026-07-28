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
function collectJsonLdTypes(blocks: unknown[]): Set<string> {
  const types = new Set<string>();
  for (const block of blocks) {
    if (!block || typeof block !== "object") continue;
    const t = (block as Record<string, unknown>)["@type"];
    if (typeof t === "string") types.add(t);
    else if (Array.isArray(t)) for (const v of t) if (typeof v === "string") types.add(v);
  }
  return types;
}

/**
 * A signal we deliberately cannot measure from the page. Scored `null` so it is
 * excluded from the weighted total AND from `coverage` (see composeScore)
 * rather than being averaged in at a neutral value and flattening the result.
 */
function unmeasured(
  key: string,
  label: string,
  weight: number,
  reason: string,
): SignalScore {
  return { key, label, score: null, weight, reason, fix: null };
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

/**
 * Byline fallback for pages with no author metadata. Deliberately narrower than
 * a bare `\bauthor\b` match, which fired on any footer containing the word.
 */
const BYLINE_RE =
  /\b(?:written by|authored by|author:)\s+[A-Z]|(?:^|[\n.!?]\s*)By\s+[A-Z][a-z]+/m;

/** Count verifiable-figure tokens (percentages, currency, multi-digit numbers). */
function countStatTokens(text: string): number {
  const matches = text.match(
    /[$£€]\s?\d[\d,.]*|\d[\d,.]*\s?%|\b\d{2,}(?:[.,]\d+)?\b|\b\d+\.\d+\b/g,
  );
  return matches ? matches.length : 0;
}

/** Headings phrased as a question (end with "?") — an FAQ/answer signal. */
function questionHeadingCount(page: CrawledPage): number {
  return page.headings.filter((h) => h.text.trim().endsWith("?")).length;
}

// --- AI signals -------------------------------------------------------------

const CONTENT_TYPE_SCHEMAS = new Set([
  "Article", "BlogPosting", "NewsArticle", "TechArticle", "Product", "FAQPage",
  "QAPage", "HowTo", "Recipe", "Review", "Event", "Course", "SoftwareApplication",
  "LocalBusiness", "Service", "MedicalWebPage",
]);

export function scoreSchema(page: CrawledPage): SignalScore {
  const types = collectJsonLdTypes(page.jsonLdBlocks);
  const hasOrg = types.has("Organization") || types.has("LocalBusiness");
  const hasSite = types.has("WebSite");
  const contentType = [...types].find((t) => CONTENT_TYPE_SCHEMAS.has(t));
  const hasBreadcrumb = types.has("BreadcrumbList");
  const hasPerson = types.has("Person") || hasJsonLdAuthor(page.jsonLdBlocks);

  const score = clamp(
    (hasOrg ? 22 : 0) +
      (hasSite ? 18 : 0) +
      (contentType ? 35 : 0) +
      (hasBreadcrumb ? 10 : 0) +
      (hasPerson ? 15 : 0),
  );

  const missing: string[] = [];
  if (!hasOrg) missing.push("Organization");
  if (!hasSite) missing.push("WebSite");
  if (!contentType) missing.push("a content type (Article, FAQPage, Product…)");

  return {
    key: "schema",
    label: "Schema Markup",
    score,
    weight: AI_WEIGHTS.schema,
    reason:
      missing.length === 0
        ? `Rich structured data present${contentType ? ` (incl. ${contentType})` : ""}.`
        : `Add JSON-LD schema: ${missing.join(", ")}.`,
    fix:
      score >= 90
        ? null
        : `Add JSON-LD schema — ${missing.length ? missing.join(", ") : "FAQPage or Article to become citable"}.`,
  };
}

export function scoreAiCrawlability(page: CrawledPage): SignalScore {
  const problems: string[] = [];
  let score = 100;
  if (!page.hasServerRenderedContent) {
    score -= 40;
    problems.push("server-render key content (AI crawlers run little JS)");
  }
  if (!page.robotsAllowsAiBots) {
    score -= 35;
    problems.push("unblock AI bots in robots.txt");
  }
  if (!page.hasLlmsTxt) {
    score -= 25;
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
    fix: problems.length === 0 ? null : `Improve AI crawlability: ${problems.join("; ")}.`,
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
 * A page with no machine-readable date is a real deficiency (answer engines
 * can't establish recency) but not the same as a page known to be years stale,
 * so it scores in the middle with a fix rather than a flat 0.
 */
const NO_DATE_SCORE = 40;

export function scoreFreshness(page: CrawledPage): SignalScore {
  const age = ageInDays(page.lastModified);

  if (age === null || age < 0) {
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
    fix: score < 100 ? "Refresh this page; AI engines decay content in 2-3 months." : null,
  };
}

const CITATION_POINTS = [0, 18, 28, 35];

export function scoreEeat(page: CrawledPage): SignalScore {
  const hasAuthor =
    Boolean(page.metaAuthor?.trim()) ||
    hasJsonLdAuthor(page.jsonLdBlocks) ||
    BYLINE_RE.test(page.renderedText);

  const citedHosts = outboundHostCount(page);
  const citationScore = CITATION_POINTS[Math.min(citedHosts, 3)];

  const score = clamp(
    (hasAuthor ? 45 : 0) + citationScore + (page.hasAboutOrContactLink ? 20 : 0),
  );

  const missing: string[] = [];
  if (!hasAuthor) missing.push("add a named author byline or Person/author schema");
  if (citedHosts < 2)
    missing.push("cite 2+ authoritative outbound sources (studies, docs, data)");
  if (!page.hasAboutOrContactLink) missing.push("link to an about/contact page");

  return {
    key: "eeat",
    label: "E-E-A-T Signals",
    score,
    weight: AI_WEIGHTS.eeat,
    reason:
      missing.length === 0
        ? `Named author, ${citedHosts} cited sources, and clear ownership — strong trust signals.`
        : `Weak trust signals: ${missing.join("; ")}.`,
    fix: missing.length === 0 ? null : `Strengthen E-E-A-T: ${missing.join("; ")}.`,
  };
}

/**
 * Structural answerability — how easily an engine can lift a citable passage.
 * Lists, tables, FAQ/Q&A, clean heading structure, and short paragraphs are the
 * shapes that get pulled into AI answers.
 */
export function scoreAnswerability(page: CrawledPage): SignalScore {
  // Lists.
  let listScore = 0;
  if (page.listCount > 0) listScore = page.listItemCount >= 6 ? 25 : 15;

  // Tables.
  const tableScore = page.tableCount > 0 ? 15 : 0;

  // FAQ / Q&A.
  const types = collectJsonLdTypes(page.jsonLdBlocks);
  const hasFaqSchema = types.has("FAQPage") || types.has("QAPage");
  const questions = questionHeadingCount(page);
  let faqScore = 0;
  if (hasFaqSchema || questions >= 2) faqScore = 25;
  else if (questions >= 1) faqScore = 12;

  // Heading structure.
  const levels = new Set(page.headings.map((h) => h.level));
  let headingScore = 0;
  if (page.headings.length >= 3 && levels.size >= 2) headingScore = 20;
  else if (page.headings.length >= 2) headingScore = 10;

  // Paragraph conciseness (long paragraphs are hard to extract from).
  let proseScore = 0;
  if (page.paragraphCount > 0) {
    const longRatio = page.longParagraphCount / page.paragraphCount;
    proseScore = longRatio <= 0.3 ? 15 : longRatio <= 0.5 ? 8 : 0;
  }

  const score = clamp(listScore + tableScore + faqScore + headingScore + proseScore);

  const missing: string[] = [];
  if (listScore < 25) missing.push("break key points into bullet/numbered lists");
  if (faqScore < 25) missing.push("add an FAQ section (question headings + FAQPage schema)");
  if (tableScore === 0) missing.push("use a comparison table where it fits");
  if (proseScore < 15) missing.push("shorten long paragraphs into scannable chunks");

  return {
    key: "answerability",
    label: "Answer-ready Structure",
    score,
    weight: AI_WEIGHTS.answerability,
    reason:
      score >= 80
        ? "Well-structured for extraction: lists, headings, and scannable prose."
        : "Content is hard for AI to lift into an answer.",
    fix: score >= 80 ? null : `Make it answer-ready: ${missing.slice(0, 3).join("; ")}.`,
  };
}

/**
 * Fact density — verifiable statistics, figures, and quotations. Adding
 * statistics was the single strongest method in Princeton's GEO study (+41%);
 * the practical target is roughly one figure per 100 words.
 */
export function scoreFactDensity(page: CrawledPage): SignalScore {
  const stats = countStatTokens(page.renderedText);
  const per100 = page.wordCount > 0 ? stats / (page.wordCount / 100) : 0;

  let statScore: number;
  if (stats === 0) statScore = 0;
  else if (per100 >= 1) statScore = 60;
  else if (per100 >= 0.5) statScore = 45;
  else if (per100 >= 0.2) statScore = 28;
  else statScore = 12;

  const hasQuote =
    page.blockquoteCount > 0 || /[“"][^“”"]{15,}[”"]/.test(page.renderedText);
  const quoteScore = page.blockquoteCount > 0 ? 40 : hasQuote ? 20 : 0;

  const score = clamp(statScore + quoteScore);

  const missing: string[] = [];
  if (statScore < 60)
    missing.push("add verifiable statistics/figures (aim for ~1 per 100 words)");
  if (quoteScore < 40) missing.push("include an expert quote or blockquote");

  return {
    key: "factDensity",
    label: "Fact Density & Evidence",
    score,
    weight: AI_WEIGHTS.factDensity,
    reason:
      score >= 70
        ? `Specific and evidence-backed (${stats} figures detected).`
        : `Thin on citable evidence (${stats} figures for ${page.wordCount} words).`,
    fix: score >= 70 ? null : `Add evidence: ${missing.join("; ")}.`,
  };
}

export function scoreBrandMentions(page: CrawledPage): SignalScore {
  void page;
  return unmeasured(
    "brandMentions",
    "Brand Mentions",
    AI_WEIGHTS.brandMentions,
    "Off-page signal — filled in by the live AI-citation check when an engine API key is configured.",
  );
}

// --- Traditional signals ----------------------------------------------------

export function scoreContentQuality(page: CrawledPage): SignalScore {
  const w = page.wordCount;
  let base: number;
  if (w < 200) base = 15;
  else if (w < 400) base = 35;
  else if (w < 800) base = 58;
  else if (w < 1500) base = 78;
  else base = 90;

  const structured =
    (page.listCount > 0 || page.tableCount > 0) && page.headings.length >= 3;
  const score = clamp(base + (structured ? 10 : 0));

  return {
    key: "contentQuality",
    label: "Content Quality",
    score,
    weight: TRADITIONAL_WEIGHTS.contentQuality,
    reason: `${w} words${structured ? ", well-structured" : ""}.`,
    fix:
      score < 80
        ? "Expand into genuinely helpful, in-depth content with clear structure."
        : null,
  };
}

export function scoreTechnicalSeo(page: CrawledPage): SignalScore {
  const hasTitle = page.title !== null && page.title.trim() !== "";
  const hasMeta = page.metaDescription !== null && page.metaDescription.trim() !== "";
  const oneH1 = page.headings.filter((h) => h.level === 1).length === 1;
  const ok200 = page.statusCode === 200;
  const isHttps = page.url.startsWith("https://");
  const altScore =
    page.imageCount === 0 ? 6 : Math.round((page.imagesWithAlt / page.imageCount) * 6);

  const score = clamp(
    (hasTitle ? 14 : 0) +
      (hasMeta ? 14 : 0) +
      (oneH1 ? 12 : 0) +
      (ok200 ? 10 : 0) +
      (isHttps ? 15 : 0) +
      (page.hasCanonical ? 10 : 0) +
      (page.hasViewportMeta ? 13 : 0) +
      (page.htmlLang ? 6 : 0) +
      altScore,
  );

  const missing: string[] = [];
  if (!hasTitle) missing.push("add a <title>");
  if (!hasMeta) missing.push("add a meta description");
  if (!oneH1) missing.push("use exactly one H1");
  if (!isHttps) missing.push("serve over HTTPS");
  if (!page.hasViewportMeta) missing.push("add a mobile viewport meta");
  if (!page.hasCanonical) missing.push("add a canonical link");
  if (page.imageCount > 0 && page.imagesWithAlt < page.imageCount)
    missing.push("add alt text to all images");

  return {
    key: "technicalSeo",
    label: "Technical SEO",
    score,
    weight: TRADITIONAL_WEIGHTS.technicalSeo,
    reason:
      missing.length === 0
        ? "Core technical signals (title, meta, H1, HTTPS, canonical, mobile) all present."
        : `Technical gaps: ${missing.slice(0, 4).join("; ")}.`,
    fix: missing.length === 0 ? null : `Fix technical SEO: ${missing.slice(0, 4).join("; ")}.`,
  };
}

export function scoreTopicalAuthority(page: CrawledPage): SignalScore {
  const levels = new Set(page.headings.map((h) => h.level));
  const headingScore =
    (Math.min(page.headings.length, 12) / 12) * 30 +
    (Math.min(levels.size, 4) / 4) * 15;
  const internalScore = (Math.min(page.internalLinkCount, 20) / 20) * 55;
  const score = clamp(Math.round(headingScore + internalScore));

  return {
    key: "topicalAuthority",
    label: "Topical Authority",
    score,
    weight: TRADITIONAL_WEIGHTS.topicalAuthority,
    reason: `${page.headings.length} headings, ${page.internalLinkCount} internal links (topic-cluster signal).`,
    fix:
      score < 75
        ? "Deepen the topic: add sections and internal links to related pages (build a cluster)."
        : null,
  };
}

/** Quality (not mere presence) of title/meta and social markup. */
export function scoreOnPageOptimization(page: CrawledPage): SignalScore {
  const titleLen = page.title?.trim().length ?? 0;
  const metaLen = page.metaDescription?.trim().length ?? 0;

  const titleScore = titleLen === 0 ? 0 : titleLen >= 20 && titleLen <= 70 ? 35 : 18;
  const metaScore = metaLen === 0 ? 0 : metaLen >= 70 && metaLen <= 165 ? 35 : 18;
  const ogScore = page.hasOpenGraph ? 30 : 0;

  const score = clamp(titleScore + metaScore + ogScore);

  const missing: string[] = [];
  if (titleScore < 35) missing.push(titleLen === 0 ? "add a title" : "tune the title to 20-70 chars");
  if (metaScore < 35)
    missing.push(metaLen === 0 ? "add a meta description" : "tune the meta description to 70-165 chars");
  if (!page.hasOpenGraph) missing.push("add Open Graph tags for rich sharing");

  return {
    key: "onPageOptimization",
    label: "On-page Optimization",
    score,
    weight: TRADITIONAL_WEIGHTS.onPageOptimization,
    reason:
      missing.length === 0
        ? "Title and meta description are well-sized and Open Graph is present."
        : `On-page tuning needed: ${missing.join("; ")}.`,
    fix: missing.length === 0 ? null : `Tune on-page: ${missing.join("; ")}.`,
  };
}

export function scoreBacklinks(page: CrawledPage): SignalScore {
  void page;
  return unmeasured(
    "backlinks",
    "Backlinks",
    TRADITIONAL_WEIGHTS.backlinks,
    "Off-page signal — requires a backlink index (added when paid data is enabled).",
  );
}
