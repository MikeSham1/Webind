/**
 * Competitive benchmarking.
 *
 * WeBind's headline scores grade a page against our theory of what AI engines
 * reward. This grades it against the pages *actually winning* the query: pull
 * the organic field (and, where available, the pages AI engines cite), crawl
 * and score each with the same engine, then report where the target sits in
 * that distribution as a competitive percentile — not another absolute number.
 *
 * Every external dependency (the SERP API, the crawler, the scorer) is
 * injectable, so the whole pipeline is testable offline and degrades honestly
 * when the SERP key is absent.
 */

/** One organic result as returned by the SERP provider. */
export interface SerpResult {
  position: number;
  title: string;
  link: string;
  snippet?: string;
}

/** Which slice of the competitive field a page came from. */
export type Cohort = "top" | "near";

/** A competitor page, crawled and scored (or the reason it couldn't be). */
export interface CompetitorScore {
  url: string;
  domain: string;
  /** Organic position that surfaced this page. */
  position: number;
  cohort: Cohort;
  /** 0-100 AI-readiness total, or null when the crawl/score failed. */
  ai: number | null;
  /** 0-100 traditional-authority total, or null when it failed. */
  traditional: number | null;
  ok: boolean;
  error?: string;
}

/** A competitive percentile with a bootstrap credible band. */
export interface Percentile {
  /** 0-100 percentile of the target within the cohort (shrunk toward 50). */
  value: number;
  /** Bootstrap 95% interval bounds, 0-100. */
  lo: number;
  hi: number;
  /** Cohort size the percentile was computed over. */
  n: number;
}

export interface BenchmarkReport {
  query: string;
  target: {
    url: string;
    domain: string;
    ai: number | null;
    traditional: number | null;
  };
  competitors: CompetitorScore[];
  /** Percentile of the target's AI score across successfully-scored rivals. */
  aiPercentile: Percentile | null;
  traditionalPercentile: Percentile | null;
  /** True when a SERP key was configured and a cohort was actually built. */
  configured: boolean;
  /** Human-readable status — why a percentile is or isn't present. */
  note: string;
}
