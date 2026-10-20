import type { CrawledPage } from "./types";
import { classifyPageType, type PageType } from "./page-type";

/**
 * Evidence Integrity — does the page *support* its factual claims, rather than
 * just contain a lot of numbers?
 *
 * This replaces the old "count statistics per 100 words" heuristic, which
 * rewarded stuffing figures in and was trivially gamed. Newer GEO evaluations
 * (C-SEO Bench, SAGEO Arena) found generic "add more stats" prescriptions
 * unreliable, while genuinely supporting claims tracks what engines cite.
 *
 * The full target is the doc's 7-step model: extract verifiable claims →
 * classify importance → find each claim's source → fetch it → check the source
 * actually entails the claim → weigh source quality/freshness → measure
 * supported coverage. Steps that require fetching external pages and a model to
 * judge entailment are deferred (they need the crawler + model credits and must
 * not be faked). What we measure here, deterministically and offline:
 *
 *   - CLAIMS: block-level units (paragraphs, list items, quotes, and each data
 *     table as a whole) that assert something externally verifiable — i.e.
 *     carry a statistic/figure. Years, dates, phone numbers, and site chrome
 *     (nav, header, footer) are not claims.
 *   - IN-PLACE CITATION: whether that same block links to an external source, so
 *     the claim is attributable where it's made (the citation-clarity signal).
 *   - SOURCING BREADTH: how many distinct external sources the page's content
 *     cites. Footer social icons and "share this" buttons are not sources.
 *
 * So "add ten more unsourced numbers" no longer helps — each claim has to be
 * backed. The entailment layer can later refine "backed" from "links to a
 * source" to "links to a source that actually supports it".
 */

/** A single verifiable figure: currency, percentage, or a multi-digit number. */
const STAT_RE = /[$£€]\s?\d[\d,.]*|\d[\d,.]*\s?%|\b\d{2,}(?:[.,]\d+)?\b|\b\d+\.\d+\b/;

/**
 * Numbers that appear in text without asserting anything verifiable: calendar
 * dates, phone numbers, reading-time labels, and bare years. They're blanked
 * before the figure test, so "Since 2019" or a dateline isn't graded as an
 * uncited statistic, while "grew 40% in 2023" still is. Dates and phone numbers
 * run first because the year pattern would otherwise leave their other digits
 * behind. A four-digit number from 1800 to 2099 reads as a year unless it's
 * money, a percentage, or part of a longer number.
 */
const NON_CLAIM_NUMBERS: RegExp[] = [
  /\b\d{4}-\d{1,2}-\d{1,2}\b/g, // 2026-03-03
  /\b\d{1,2}[/.]\d{1,2}[/.]\d{2,4}\b/g, // 03/03/2026, 3.3.2026
  /(?:\+\d{1,3}[\s.-]?)?\(?\b\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b/g, // (512) 555-0142
  /\b\d+\s*min(?:ute)?s?\s+read\b/gi, // 12 min read
  /(?<![$£€\d.,]|[$£€]\s)\b(?:1[89]|20)\d{2}s?\b(?![.,]?\d|\s?%)/g, // 2019, 1990s
];

/**
 * Site chrome and non-content elements. Their numbers aren't the page's claims
 * ("Pricing from $19", "© 2026", a street address) and their links aren't its
 * sources (social icons, partner logos), so both are dropped before analysis.
 * An article's own <header> (title, byline, dateline) goes too: it carries no
 * evidence.
 */
const BOILERPLATE_RE = /<(nav|header|footer|script|style|noscript|template)\b[^>]*>[\s\S]*?<\/\1>/gi;

/**
 * An innermost data table, plus the <figcaption> right after it when it sits in
 * a <figure> (the WordPress table block's markup). A table is attributed as a
 * whole, by its caption or a source row, so it's ONE claim unit rather than one
 * per numeric cell.
 */
const DATA_TABLE_RE =
  /(?:<figure\b[^>]*>\s*)?<table\b[^>]*>((?:(?!<\/?table\b)[\s\S])*)<\/table>(?:\s*<figcaption\b[^>]*>([\s\S]*?)<\/figcaption>)?/gi;

/** A table holding paragraphs or lists is page layout, not data. */
const LAYOUT_TABLE_RE = /<(?:p|li|blockquote)\b/i;

/** Block-level elements whose text we treat as one claim-bearing unit. */
const BLOCK_RE = /<(p|li|blockquote)\b[^>]*>([\s\S]*?)<\/\1>/gi;

/** An <a href> to an absolute http(s) URL; captures the URL. */
const HREF_RE = /<a\b[^>]*?\bhref\s*=\s*["'](https?:\/\/[^"']+)["']/gi;

/**
 * "Share this" buttons link to a social network's composer, not to a source,
 * so they never count as a citation.
 */
const SHARE_INTENT_RE =
  /^https?:\/\/(?:[\w-]+\.)*(?:(?:twitter|x)\.com\/(?:intent|share)|facebook\.com\/(?:sharer|dialog\/(?:share|feed))|linkedin\.com\/(?:shareArticle|sharing)|pinterest\.[a-z.]+\/pin\/create|reddit\.com\/submit|news\.ycombinator\.com\/submitlink|wa\.me\/|api\.whatsapp\.com\/send|t(?:elegram)?\.me\/share)/i;

/** Named references worth keeping; every other named one becomes a space. */
const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  nbsp: " ",
  dollar: "$",
  percnt: "%",
  pound: "£",
  euro: "€",
};

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

/**
 * Decode character references. The HTML is the raw response, and WordPress
 * writes every curly apostrophe, quote, and dash as one ("it&#8217;s"), whose
 * digits would otherwise read as a statistic in nearly every paragraph.
 */
function decodeEntities(text: string): string {
  return text.replace(/&(#x[\da-f]+|#\d+|[a-z][a-z\d]*);/gi, (_, ref: string) => {
    if (ref[0] !== "#") return NAMED_ENTITIES[ref.toLowerCase()] ?? " ";
    const code = ref[1] === "x" || ref[1] === "X" ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : " ";
  });
}

/** A unit's visible text, with non-claim numbers blanked out. */
function claimText(html: string): string {
  const text = decodeEntities(html.replace(/<[^>]+>/g, " "));
  return NON_CLAIM_NUMBERS.reduce((t, re) => t.replace(re, " "), text);
}

/** Distinct external hosts `html` links to, ignoring self-links and share buttons. */
function sourceHosts(html: string, selfHost: string | null): Set<string> {
  const hosts = new Set<string>();
  for (const [, url] of html.matchAll(HREF_RE)) {
    if (SHARE_INTENT_RE.test(url)) continue;
    const host = hostOf(url);
    if (host && host !== selfHost) hosts.add(host);
  }
  return hosts;
}

/**
 * The page's claim-bearing units, as inner HTML: each data table (with its
 * caption) once, then each paragraph, list item, and blockquote.
 */
function claimUnits(content: string): string[] {
  const units: string[] = [];
  const rest = content.replace(
    DATA_TABLE_RE,
    (whole: string, table: string, caption: string | undefined) => {
      if (LAYOUT_TABLE_RE.test(table)) return whole; // its paragraphs are units of their own
      units.push(caption ? `${table} ${caption}` : table);
      return " ";
    },
  );
  for (const m of rest.matchAll(BLOCK_RE)) units.push(m[2]);
  return units;
}

export interface EvidenceAnalysis {
  /** Block-level units that assert a verifiable figure. */
  claims: number;
  /** Of those, how many cite an external source in the same block. */
  supportedClaims: number;
  /** 0-1 share of claims backed by an in-place citation. */
  coverage: number;
  /** Distinct external hosts the page's content cites (chrome and share links excluded). */
  distinctSources: number;
  /** Whether the page carries a blockquote / long quotation (primary voice). */
  hasQuote: boolean;
}

/**
 * Pure, deterministic analysis of a page's claim → source support. Claims and
 * sources are both read from the page's content in the served HTML, which is
 * what an AI crawler sees. Navigation, header, and footer chrome is excluded
 * from both.
 */
export function analyzeEvidence(page: CrawledPage): EvidenceAnalysis {
  const selfHost = hostOf(page.url);
  const content = page.html.replace(BOILERPLATE_RE, " ");

  let claims = 0;
  let supportedClaims = 0;
  for (const unit of claimUnits(content)) {
    if (!STAT_RE.test(claimText(unit))) continue; // not a verifiable claim
    claims += 1;
    // Does this unit cite an external source in place?
    if (sourceHosts(unit, selfHost).size > 0) supportedClaims += 1;
  }

  const distinctSources = sourceHosts(content, selfHost).size;

  const hasQuote =
    page.blockquoteCount > 0 || /[“"][^“”"]{15,}[”"]/.test(page.renderedText);

  return {
    claims,
    supportedClaims,
    coverage: claims > 0 ? supportedClaims / claims : 0,
    distinctSources,
    hasQuote,
  };
}

function clamp(n: number, min = 0, max = 100): number {
  return Math.min(max, Math.max(min, n));
}

export interface EvidenceScore {
  score: number;
  analysis: EvidenceAnalysis;
  reason: string;
  fix: string | null;
}

/**
 * Turn the analysis into a 0-100 Evidence Integrity score. Weighted toward
 * supported-claim coverage (the thing that's hard to fake), with smaller credit
 * for citing distinct sources at all and for carrying a primary-source quote.
 *
 * Page-type aware: an evidence document (an article) is held to the citation
 * standard, but a homepage, product, or category page isn't an evidence page,
 * so a lack of cited claims there isn't a deficiency — we don't tank it or nag
 * it to "cite your sources".
 */
export function scoreEvidence(
  page: CrawledPage,
  pageType: PageType = classifyPageType(page),
): EvidenceScore {
  const a = analyzeEvidence(page);
  const quoteCredit = page.blockquoteCount > 0 ? 10 : a.hasQuote ? 5 : 0;
  const sourcingCredit = Math.min(25, a.distinctSources * 8);
  // Only articles are graded strictly on evidence; other page types get a
  // neutral floor and no "add citations" nag.
  const evidenceExpected = pageType === "article";

  let score: number;
  if (a.claims === 0) {
    if (!evidenceExpected) {
      // Not an evidence-first page type — citations aren't its job.
      score = 60;
    } else {
      // An article with no verifiable claims: thin. Credit sourcing/quotes only.
      score = clamp(Math.min(20, a.distinctSources * 7) + quoteCredit);
    }
  } else {
    const raw = clamp(Math.round(a.coverage * 65) + sourcingCredit + quoteCredit);
    // Where evidence isn't the page's job, don't punish uncited claims hard.
    score = evidenceExpected ? raw : Math.max(55, raw);
  }

  const unsupported = a.claims - a.supportedClaims;
  const reason =
    a.claims === 0
      ? evidenceExpected
        ? "No verifiable claims detected to attribute — thin for an article."
        : "Not an evidence-first page type, so in-line citations aren't expected here."
      : a.coverage >= 0.7
        ? `Most factual claims are cited in place (${a.supportedClaims}/${a.claims}).`
        : `${unsupported} of ${a.claims} factual claims aren't linked to a source.`;

  // Only nag about citations where they're genuinely expected.
  const fix =
    !evidenceExpected
      ? null
      : a.claims === 0
        ? a.distinctSources === 0
          ? "Back the page's key points with primary sources — original data, first-hand results, or a named authority."
          : null
        : a.coverage >= 0.7
          ? null
          : "Cite the primary source next to each important claim — link the figure to the data or authority it came from.";

  return { score, analysis: a, reason, fix };
}
