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
 *   - CLAIMS: block-level units (paragraphs, list items, cells, quotes) that
 *     assert something externally verifiable — i.e. carry a statistic/figure.
 *   - IN-PLACE CITATION: whether that same block links to an external source, so
 *     the claim is attributable where it's made (the citation-clarity signal).
 *   - SOURCING BREADTH: how many distinct external sources the page cites at all.
 *
 * So "add ten more unsourced numbers" no longer helps — each claim has to be
 * backed. The entailment layer can later refine "backed" from "links to a
 * source" to "links to a source that actually supports it".
 */

/** A single verifiable figure: currency, percentage, or a multi-digit number. */
const STAT_RE = /[$£€]\s?\d[\d,.]*|\d[\d,.]*\s?%|\b\d{2,}(?:[.,]\d+)?\b|\b\d+\.\d+\b/;

/** Block-level elements whose text we treat as one claim-bearing unit. */
const BLOCK_RE = /<(p|li|td|blockquote)\b[^>]*>([\s\S]*?)<\/\1>/gi;

/** External-link href inside a block; capture the host. */
const HREF_RE = /<a\b[^>]*\bhref=["']https?:\/\/([^"'/?#]+)/gi;

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, " ");
}

export interface EvidenceAnalysis {
  /** Block-level units that assert a verifiable figure. */
  claims: number;
  /** Of those, how many cite an external source in the same block. */
  supportedClaims: number;
  /** 0-1 share of claims backed by an in-place citation. */
  coverage: number;
  /** Distinct external hosts the page cites anywhere. */
  distinctSources: number;
  /** Whether the page carries a blockquote / long quotation (primary voice). */
  hasQuote: boolean;
}

/** Pure, deterministic analysis of a page's claim → source support. */
export function analyzeEvidence(page: CrawledPage): EvidenceAnalysis {
  const selfHost = hostOf(page.url);

  let claims = 0;
  let supportedClaims = 0;
  let m: RegExpExecArray | null;
  BLOCK_RE.lastIndex = 0;
  while ((m = BLOCK_RE.exec(page.html)) !== null) {
    const inner = m[2];
    const text = stripTags(inner);
    if (!STAT_RE.test(text)) continue; // not a verifiable claim
    claims += 1;

    // Does this block cite an external source in place?
    HREF_RE.lastIndex = 0;
    let cited = false;
    let h: RegExpExecArray | null;
    while ((h = HREF_RE.exec(inner)) !== null) {
      const host = h[1].toLowerCase().replace(/^www\./, "");
      if (host && host !== selfHost) {
        cited = true;
        break;
      }
    }
    if (cited) supportedClaims += 1;
  }

  const distinctSources = new Set(
    page.outboundLinks.map(hostOf).filter((h): h is string => Boolean(h) && h !== selfHost),
  ).size;

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
