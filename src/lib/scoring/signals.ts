import type { CrawledPage, SignalScore } from "./types";
import { AI_WEIGHTS, TRADITIONAL_WEIGHTS } from "./weights";
import { scoreEvidence } from "./evidence-integrity";
import { classifyPageType } from "./page-type";

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
  // Recommend a content type that MATCHES the page (Article/Product/HowTo…) —
  // never a generic FAQPage. Google removed FAQ rich results in 2026 and says
  // no special schema is needed for generative Search, so pushing FAQPage as a
  // default "become citable" trick is outdated.
  if (!contentType) missing.push("a content type that matches the page (Article, Product, HowTo…)");

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
        : `Add JSON-LD schema — ${missing.length ? missing.join(", ") : "the content type that matches this page"}.`,
  };
}

export function scoreAiCrawlability(page: CrawledPage): SignalScore {
  // Only the two things that actually gate whether an AI engine can read the
  // page: is the content server-rendered (AI crawlers run little JS), and are
  // AI crawlers allowed in robots.txt. llms.txt is deliberately NOT scored —
  // as of 2026 the major engines have said it neither helps nor hurts
  // visibility, so penalizing its absence would be manufacturing a problem.
  // It stays available as an optional generated asset (see optimize/assets),
  // just not as a scored/ranked deficiency.
  const problems: string[] = [];
  let score = 100;
  if (!page.hasServerRenderedContent) {
    score -= 55;
    problems.push("server-render key content (AI crawlers run little JS)");
  }
  if (!page.robotsAllowsAiBots) {
    score -= 45;
    problems.push("unblock AI search crawlers in robots.txt");
  }
  score = clamp(score);
  return {
    key: "aiCrawlability",
    label: "AI Crawlability",
    score,
    weight: AI_WEIGHTS.aiCrawlability,
    reason:
      problems.length === 0
        ? "Server-rendered and AI search crawlers are allowed."
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
  // A visible "last updated" date is what an article or news page lives or dies
  // on; a homepage, product, or category page doesn't need one, so a missing
  // date there isn't the same deficiency.
  const dateMatters = classifyPageType(page) === "article";

  if (age === null || age < 0) {
    const futureDate = age !== null;
    return {
      key: "freshness",
      label: "Content Freshness",
      score: futureDate ? NO_DATE_SCORE : dateMatters ? NO_DATE_SCORE : 70,
      weight: AI_WEIGHTS.freshness,
      reason: futureDate
        ? "The page's stated update date is in the future, so it can't be trusted."
        : dateMatters
          ? "No machine-readable publish or update date found, so AI engines can't tell how current this page is."
          : "No machine-readable date — fine for this page type, which isn't time-sensitive the way an article is.",
      fix:
        futureDate || dateMatters
          ? "Publish an explicit update date — JSON-LD `dateModified` or an " +
            "`article:modified_time` meta tag — so AI engines can verify recency."
          : null,
    };
  }

  const via = page.lastModifiedSource
    ? ` (via ${DATE_SOURCE_LABEL[page.lastModifiedSource]})`
    : "";

  // How much recency matters is genuinely topic-dependent — a news or pricing
  // page ages fast, an evergreen explainer barely at all. Until we model query
  // and content type (roadmap), we apply a gentle, non-punitive decay and floor
  // an old-but-dated page well above zero rather than asserting a universal
  // "content decays in N months" rule the evidence doesn't support.
  let score: number;
  let reason: string;
  if (age < 180) {
    score = 100;
    reason = `Updated within the last 6 months${via}.`;
  } else if (age < 365) {
    score = 75;
    reason = `Last updated 6-12 months ago${via}.`;
  } else if (age < 730) {
    score = 55;
    reason = `Last updated 1-2 years ago${via}.`;
  } else {
    score = 40;
    reason = `Last updated over 2 years ago${via}.`;
  }

  return {
    key: "freshness",
    label: "Content Freshness",
    score,
    weight: AI_WEIGHTS.freshness,
    reason,
    fix:
      score < 100
        ? "If the topic changes over time, refresh the page and its update date; for evergreen topics a stable date is fine."
        : null,
  };
}

const CITATION_POINTS = [0, 15, 22, 30];

/** True when the analyzed URL is the site root (a homepage). */
function isRootPage(url: string): boolean {
  try {
    const p = new URL(url).pathname;
    return p === "/" || p === "";
  } catch {
    return false;
  }
}

/** Recursively test whether any JSON-LD node (incl. inside `@graph`) has a wanted `@type`. */
function jsonLdHasType(blocks: unknown[], wanted: Set<string>): boolean {
  const visit = (b: unknown): boolean => {
    if (!b || typeof b !== "object") return false;
    const rec = b as Record<string, unknown>;
    const t = rec["@type"];
    if (typeof t === "string" && wanted.has(t)) return true;
    if (Array.isArray(t) && t.some((x) => typeof x === "string" && wanted.has(x))) return true;
    const graph = rec["@graph"];
    return Array.isArray(graph) && graph.some(visit);
  };
  return blocks.some(visit);
}

const ENTITY_TYPES = new Set([
  "Organization",
  "LocalBusiness",
  "WebSite",
  "NewsMediaOrganization",
]);

/** Organization/WebSite identity — "who runs this site", visible on a homepage. */
function hasEntityIdentity(blocks: unknown[]): boolean {
  return jsonLdHasType(blocks, ENTITY_TYPES);
}

/** A `sameAs` with at least one URL — official social/authority profiles. */
function hasSocialProfiles(blocks: unknown[]): boolean {
  const isUrl = (x: unknown) => typeof x === "string" && /^https?:\/\//i.test(x);
  const visit = (b: unknown): boolean => {
    if (!b || typeof b !== "object") return false;
    const rec = b as Record<string, unknown>;
    if (isUrl(rec.sameAs) || (Array.isArray(rec.sameAs) && rec.sameAs.some(isUrl))) return true;
    const graph = rec["@graph"];
    return Array.isArray(graph) && graph.some(visit);
  };
  return blocks.some(visit);
}

/**
 * E-E-A-T / trust. Rebalanced so a homepage isn't tanked for a missing author
 * byline — bylines live on the ARTICLE pages we don't crawl from a single-page
 * analysis, so on a root page an absent byline is not treated as a deficiency.
 * Instead, trust is read from signals a homepage actually carries: who runs the
 * site (Organization/WebSite schema, an about/contact page, official social
 * profiles) and whether it cites authoritative sources. On a non-homepage
 * (an article), a named byline is still expected and rewarded.
 */
export function scoreEeat(page: CrawledPage): SignalScore {
  const homepage = isRootPage(page.url);
  const hasAuthor =
    Boolean(page.metaAuthor?.trim()) ||
    hasJsonLdAuthor(page.jsonLdBlocks) ||
    BYLINE_RE.test(page.renderedText);

  const citedHosts = outboundHostCount(page);
  const citationScore = CITATION_POINTS[Math.min(citedHosts, 3)]; // 0..30

  const hasIdentity = hasEntityIdentity(page.jsonLdBlocks);
  const hasSocial = hasSocialProfiles(page.jsonLdBlocks);

  // Authorship: expected on an article; on a homepage a missing byline earns
  // partial credit (identity is what matters there) rather than a zero.
  let authorScore: number;
  if (hasAuthor) authorScore = 35;
  else if (homepage) authorScore = page.hasAboutOrContactLink ? 20 : 12;
  else authorScore = 0;

  const score = clamp(
    authorScore +
      (page.hasAboutOrContactLink ? 20 : 0) +
      (hasIdentity ? 15 : 0) +
      (hasSocial ? 10 : 0) +
      citationScore,
  );

  const missing: string[] = [];
  // Only nag about a byline where one is actually expected (article pages).
  if (!hasAuthor && !homepage) {
    missing.push("add a named author byline or Person/author schema");
  }
  if (!hasIdentity) missing.push("add Organization/WebSite schema identifying who runs the site");
  if (!page.hasAboutOrContactLink) missing.push("link to an about/contact page");
  if (citedHosts < 2)
    missing.push("cite 2+ authoritative outbound sources (studies, docs, data)");

  const strong = score >= 80 || missing.length === 0;
  return {
    key: "eeat",
    label: "E-E-A-T Signals",
    score,
    weight: AI_WEIGHTS.eeat,
    reason: strong
      ? `Clear ownership${hasAuthor ? ", a named author," : ""} and ${citedHosts} cited sources — strong trust signals.`
      : `Weak trust signals: ${missing.join("; ")}.`,
    fix: strong ? null : `Strengthen E-E-A-T: ${missing.join("; ")}.`,
  };
}

/**
 * Structural answerability — how easily an engine can lift a citable passage.
 * Lists, tables, FAQ/Q&A, clean heading structure, and short paragraphs are the
 * shapes that get pulled into AI answers.
 */
export function scoreAnswerability(page: CrawledPage): SignalScore {
  // Question-style headings and answer-first restructuring are article/
  // informational-content advice — a homepage, product, or category page's job
  // is navigation and positioning, so we don't score them on Q&A structure or
  // ever tell them to turn "Shop" into "What is Shop?".
  const qaApplies = classifyPageType(page) === "article";

  // Lists.
  let listScore = 0;
  if (page.listCount > 0) listScore = page.listItemCount >= 6 ? 25 : 15;

  // Tables.
  const tableScore = page.tableCount > 0 ? 15 : 0;

  // Q&A structure — real question-style headings that directly answer what a
  // user asked. Scored on the STRUCTURE (which genuinely helps an engine lift a
  // passage), NOT on FAQPage schema: Google removed FAQ rich results in 2026
  // and says no special schema is needed for generative Search, so rewarding
  // the markup would be scoring an outdated trick. Only on articles.
  const questions = questionHeadingCount(page);
  let qaScore = 0;
  if (qaApplies) {
    if (questions >= 2) qaScore = 25;
    else if (questions >= 1) qaScore = 12;
  }

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

  const score = clamp(listScore + tableScore + qaScore + headingScore + proseScore);
  // Articles are held to the full answer-ready bar; other page types just need
  // to be scannable, since Q&A structure isn't counted for them.
  const bar = qaApplies ? 80 : 55;
  const good = score >= bar;

  const missing: string[] = [];
  if (listScore < 25) missing.push("break key points into bullet/numbered lists");
  if (qaApplies && qaScore < 25)
    missing.push("answer common questions with question-style headings, each answered in the first line");
  if (tableScore === 0) missing.push("use a comparison table where it fits");
  if (proseScore < 15) missing.push("shorten long paragraphs into scannable chunks");

  return {
    key: "answerability",
    label: "Answer-ready Structure",
    score,
    weight: AI_WEIGHTS.answerability,
    reason: good
      ? "Well-structured for extraction: lists, headings, and scannable prose."
      : qaApplies
        ? "Content is hard for AI to lift into an answer."
        : "Could be more scannable for AI to lift a clean passage.",
    fix: good
      ? null
      : `Make it ${qaApplies ? "answer-ready" : "scannable"}: ${missing.slice(0, 3).join("; ")}.`,
  };
}

/**
 * Fact density — verifiable statistics, figures, and quotations. Adding
 * statistics was the single strongest method in Princeton's GEO study (+41%);
 * the practical target is roughly one figure per 100 words.
 */
/**
 * Evidence Integrity. Grades whether the page *supports* its factual claims
 * with in-place citations, not how many numbers it contains. Keeps the
 * `factDensity` key (so weights and the Evidence & Citation stage are unchanged)
 * while relabeling to reflect the claim-centric measure. See evidence-integrity.ts.
 */
export function scoreFactDensity(page: CrawledPage): SignalScore {
  const { score, reason, fix } = scoreEvidence(page);
  return {
    key: "factDensity",
    label: "Evidence Integrity",
    score,
    weight: AI_WEIGHTS.factDensity,
    reason,
    fix,
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
  // There is no ideal page length (Google is explicit that length alone
  // doesn't affect ranking), so word count only distinguishes "too thin to
  // actually answer the topic" from "substantive enough" — we do NOT reward
  // more words beyond that adequacy floor. Structure and depth carry the rest.
  const thin = w < 150;
  const adequacy = thin ? 25 : w < 350 ? 55 : 72;
  const structured =
    (page.listCount > 0 || page.tableCount > 0) && page.headings.length >= 3;
  const hasHeadings = page.headings.length >= 2;
  const score = clamp(adequacy + (structured ? 18 : hasHeadings ? 8 : 0));

  return {
    key: "contentQuality",
    label: "Content Quality",
    score,
    weight: TRADITIONAL_WEIGHTS.contentQuality,
    reason: thin
      ? `Only ${w} words — likely too thin to fully answer the topic.`
      : `Substantive content${structured ? ", well-structured" : ""}.`,
    fix:
      score < 70
        ? "Make sure the page thoroughly answers its topic with clear structure — depth and usefulness matter more than raw length."
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

/**
 * Common English function words plus generic web boilerplate, stripped before
 * we treat the remaining title/H1 words as the page's topic terms.
 */
const TERM_STOPWORDS = new Set([
  "the", "and", "for", "with", "your", "you", "our", "are", "how", "why", "what",
  "when", "where", "who", "this", "that", "from", "into", "out", "get", "best",
  "top", "guide", "home", "page", "welcome", "site", "website", "com", "www",
  "new", "all", "more", "about", "can", "will", "has", "have", "not",
]);

/** Content terms (lowercased, deduped, ≥3 chars, non-stopword) from `text`. */
function extractTerms(text: string | null): string[] {
  if (!text) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const w of text.toLowerCase().match(/[a-z0-9]+/g) ?? []) {
    if (w.length < 3 || TERM_STOPWORDS.has(w) || seen.has(w)) continue;
    seen.add(w);
    out.push(w);
  }
  return out;
}

/** Loose presence check tolerating a simple singular/plural difference. */
function termPresent(haystack: string, term: string): boolean {
  if (haystack.includes(term)) return true;
  if (term.endsWith("s") && term.length > 3) return haystack.includes(term.slice(0, -1));
  return false;
}

/**
 * Topical authority = does the page cover ONE subject in depth, not just "has
 * many headings". Three parts:
 *   - structure: heading breadth + level variety (a page broken into sections),
 *   - internal links: topic-cluster signal (links to related pages),
 *   - topical focus (NEW): whether the page's own subject — the content terms
 *     in its title and H1 — actually recurs across its headings and body. A
 *     focused page repeats its core terms; a grab-bag names a topic once and
 *     wanders. Counting headings alone rewarded the grab-bag equally, which is
 *     exactly what "topical authority" is supposed to distinguish.
 */
export function scoreTopicalAuthority(page: CrawledPage): SignalScore {
  const levels = new Set(page.headings.map((h) => h.level));
  const structureScore =
    (Math.min(page.headings.length, 12) / 12) * 18 +
    (Math.min(levels.size, 4) / 4) * 12; // up to 30
  const internalScore = (Math.min(page.internalLinkCount, 20) / 20) * 35; // up to 35

  const h1 = page.headings.find((h) => h.level === 1)?.text ?? null;
  const terms = [...new Set([...extractTerms(page.title), ...extractTerms(h1)])];
  const headingText = page.headings.map((h) => h.text.toLowerCase()).join(" ");
  const bodyText = page.renderedText.toLowerCase();

  let focus: number;
  let focusKnown: boolean;
  if (terms.length === 0) {
    // Nothing to check (generic or missing title). Give neutral partial credit
    // when there's still real content, but nothing when the page is essentially
    // empty — so a broken, title-less page isn't handed free topical points.
    const hasContent = page.headings.length > 0 || page.wordCount > 50;
    focus = hasContent ? 0.6 : 0;
    focusKnown = false;
  } else {
    const inHeadings =
      terms.filter((t) => termPresent(headingText, t)).length / terms.length;
    const inBody = terms.filter((t) => termPresent(bodyText, t)).length / terms.length;
    focus = 0.6 * inHeadings + 0.4 * inBody;
    focusKnown = true;
  }
  const focusScore = focus * 35; // up to 35

  const score = clamp(Math.round(structureScore + internalScore + focusScore));

  const fixes: string[] = [];
  if (page.internalLinkCount < 8) fixes.push("link to related pages to build a topic cluster");
  if (page.headings.length < 4) fixes.push("break the topic into clear sections and subheadings");
  if (focusKnown && focus < 0.5)
    fixes.push("work your core topic terms into your headings and opening paragraphs so the page reads as clearly about one subject");

  return {
    key: "topicalAuthority",
    label: "Topical Authority",
    score,
    weight: TRADITIONAL_WEIGHTS.topicalAuthority,
    reason:
      `${page.headings.length} headings, ${page.internalLinkCount} internal links` +
      (focusKnown
        ? `; ${Math.round(focus * 100)}% topic focus (title terms recurring in headings/body).`
        : "; topic focus not assessable from a generic title."),
    fix: score < 75 && fixes.length > 0 ? `Deepen topical authority: ${fixes.join("; ")}.` : null,
  };
}

/** Quality (not mere presence) of title/meta and social markup. */
export function scoreOnPageOptimization(page: CrawledPage): SignalScore {
  const titleLen = page.title?.trim().length ?? 0;
  const metaLen = page.metaDescription?.trim().length ?? 0;

  // Presence and descriptiveness are what matter. Length is a USABILITY nudge —
  // an over-long title/description just truncates in a result snippet — not an
  // SEO-correctness rule (search engines have no hard title-length limit and no
  // minimum), so we only nudge the over-long end, never penalize a short one.
  const titleScore = titleLen === 0 ? 0 : titleLen <= 65 ? 35 : 28;
  const metaScore = metaLen === 0 ? 0 : metaLen <= 165 ? 35 : 28;
  const ogScore = page.hasOpenGraph ? 30 : 0;

  const score = clamp(titleScore + metaScore + ogScore);

  const missing: string[] = [];
  if (titleLen === 0) missing.push("add a descriptive title");
  else if (titleLen > 65) missing.push("shorten the title so it doesn't truncate in results");
  if (metaLen === 0) missing.push("add a meta description");
  else if (metaLen > 165) missing.push("shorten the meta description so it doesn't truncate");
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
