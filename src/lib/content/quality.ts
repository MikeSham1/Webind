import type { ContentInputs, PageType } from "./types";

/**
 * Content-only proxy for the existing Webind readiness model.
 *
 * The production readiness model scores a crawled page using content substance,
 * extractability, machine-readability, trust, freshness, links, and hard crawl
 * gates. A Markdown draft cannot know robots, rendering, schema, canonical,
 * OpenGraph, or site-level identity, so this module deliberately scores only
 * the dimensions the writer can actually influence.
 *
 * This is an evaluation / curation signal, NOT ground truth and NOT a training
 * label by itself. Human approval and measured visibility outcomes stay primary.
 */

export interface ContentQualityScore {
  score: number;
  dimensions: {
    substance: number;
    extractability: number;
    readability: number;
    evidence: number;
    intent: number;
  };
  warnings: string[];
}

interface MarkdownStats {
  wordCount: number;
  headingCount: number;
  h2Count: number;
  listItemCount: number;
  tableCount: number;
  blockquoteCount: number;
  paragraphCount: number;
  longParagraphRatio: number;
  outboundLinkCount: number;
  placeholderCount: number;
}

const WORD_TARGETS: Record<PageType, { min: number; half: number }> = {
  landing: { min: 180, half: 450 },
  blog: { min: 500, half: 1200 },
  product: { min: 220, half: 600 },
  about: { min: 220, half: 650 },
  faq: { min: 220, half: 650 },
};

function clamp(x: number, lo = 0, hi = 1): number {
  return Math.max(lo, Math.min(hi, x));
}

function saturating(x: number, half: number): number {
  return x <= 0 ? 0 : x / (x + half);
}

function words(text: string): string[] {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\[[^\]]+\]\([^\)]+\)/g, (m) => m.replace(/[\[\]\(\)]/g, " "))
    .toLowerCase()
    .match(/[a-z0-9][a-z0-9'’-]*/g) ?? [];
}

function stats(markdown: string): MarkdownStats {
  const lines = markdown.split(/\r?\n/);
  const paragraphs = markdown
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p && !/^#{1,6}\s/.test(p) && !/^[-*+]\s/.test(p) && !/^\|/.test(p));
  const longParagraphs = paragraphs.filter((p) => words(p).length > 90).length;

  return {
    wordCount: words(markdown).length,
    headingCount: lines.filter((l) => /^#{1,6}\s+/.test(l)).length,
    h2Count: lines.filter((l) => /^##\s+/.test(l)).length,
    listItemCount: lines.filter((l) => /^\s*(?:[-*+] |\d+\.\s+)/.test(l)).length,
    tableCount: Math.floor(lines.filter((l) => /^\s*\|.*\|\s*$/.test(l)).length / 2),
    blockquoteCount: lines.filter((l) => /^>\s+/.test(l)).length,
    paragraphCount: paragraphs.length,
    longParagraphRatio: paragraphs.length ? longParagraphs / paragraphs.length : 0,
    outboundLinkCount: (markdown.match(/\]\(https?:\/\//g) ?? []).length,
    placeholderCount: (markdown.match(/\[[^\]]*(?:cite|source|figure|price|year|name|number|your )[^\]]*\]/gi) ?? []).length,
  };
}

function phraseFrequency(markdown: string, phrase: string): number {
  const haystack = words(markdown).join(" ");
  const needle = words(phrase).join(" ");
  if (!needle) return 0;
  let count = 0;
  let from = 0;
  while (true) {
    const i = haystack.indexOf(needle, from);
    if (i < 0) break;
    count++;
    from = i + needle.length;
  }
  return count;
}

function intentScore(inputs: ContentInputs, markdown: string, s: MarkdownStats): { value: number; warnings: string[] } {
  const warnings: string[] = [];
  const title = markdown.match(/^\s*#\s+(.+?)\s*$/m)?.[1] ?? "";
  const topicTerms = new Set(words(inputs.topic));
  const titleTerms = new Set(words(title));
  const overlap = topicTerms.size
    ? [...topicTerms].filter((t) => titleTerms.has(t)).length / topicTerms.size
    : 1;

  let keywordNaturalness = 1;
  for (const kw of inputs.keywords ?? []) {
    const occurrences = phraseFrequency(markdown, kw);
    const perThousand = s.wordCount ? (occurrences * 1000) / s.wordCount : 0;
    if (occurrences === 0) keywordNaturalness -= 0.08;
    if (perThousand > 12) {
      keywordNaturalness -= Math.min(0.35, (perThousand - 12) / 50);
      warnings.push(`Target term appears unusually often: ${kw}`);
    }
  }

  const pageShape = (() => {
    switch (inputs.pageType) {
      case "blog":
        return clamp((s.h2Count >= 2 ? 0.6 : 0.3) + (s.outboundLinkCount > 0 ? 0.4 : 0.15));
      case "faq":
        return clamp(s.h2Count / 4);
      case "product":
        return clamp((s.tableCount > 0 ? 0.55 : 0.25) + (s.listItemCount >= 3 ? 0.45 : 0.2));
      case "landing":
        return clamp((s.h2Count >= 2 ? 0.55 : 0.3) + (s.listItemCount >= 3 ? 0.45 : 0.25));
      case "about":
        return clamp((s.h2Count >= 2 ? 0.55 : 0.3) + (s.paragraphCount >= 3 ? 0.45 : 0.25));
    }
  })();

  return { value: clamp(0.35 * overlap + 0.35 * keywordNaturalness + 0.3 * pageShape), warnings };
}

export function scoreContentQuality(inputs: ContentInputs, markdown: string): ContentQualityScore {
  const s = stats(markdown);
  const target = WORD_TARGETS[inputs.pageType];
  const warnings: string[] = [];

  // Mirrors teacher.ts: depth rises quickly then saturates, while truly thin
  // pages are explicitly penalized. Thresholds are page-type aware here because
  // a product page and a long-form article should not be forced to the same size.
  const depth = saturating(s.wordCount, target.half);
  const thinPenalty = s.wordCount < target.min ? 0.55 : 1;
  const substance = clamp(depth * thinPenalty);
  if (s.wordCount < target.min) warnings.push(`Thin for ${inputs.pageType} intent (${s.wordCount} words)`);

  // Same extraction primitives as the readiness teacher, with the weights
  // renormalized because Markdown cannot express every page-level feature.
  const structure =
    0.45 * saturating(s.listItemCount, 8) +
    0.35 * saturating(s.tableCount, 2) +
    0.2 * saturating(s.blockquoteCount, 2);
  const headings = s.headingCount > 0 ? (s.h2Count > 0 ? 1 : 0.6) : 0.2;
  const extractability = clamp(0.62 * structure + 0.38 * headings);

  const readability = clamp(1 - 0.6 * s.longParagraphRatio);
  if (s.longParagraphRatio > 0.3) warnings.push("Too many long, unbroken paragraphs");

  // Evidence is intentionally modest. External links can support claims, while
  // placeholders are preferable to fabrication when facts are missing. Neither
  // is rewarded enough to encourage citation spam or placeholder-heavy copy.
  const evidence = clamp(
    0.65 * saturating(s.outboundLinkCount, inputs.pageType === "blog" ? 3 : 2) +
      0.35 * saturating(s.placeholderCount, 2),
  );

  const intent = intentScore(inputs, markdown, s);
  warnings.push(...intent.warnings);

  const blended =
    0.30 * substance +
    0.24 * extractability +
    0.18 * readability +
    0.10 * evidence +
    0.18 * intent.value;

  return {
    score: Math.round(clamp(blended) * 1000) / 10,
    dimensions: {
      substance: Math.round(substance * 1000) / 10,
      extractability: Math.round(extractability * 1000) / 10,
      readability: Math.round(readability * 1000) / 10,
      evidence: Math.round(evidence * 1000) / 10,
      intent: Math.round(intent.value * 1000) / 10,
    },
    warnings,
  };
}
