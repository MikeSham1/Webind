/**
 * Keyword visibility across AI answer engines.
 *
 * The free report scores a single page in isolation. This measures the other
 * half of the job: for the queries people actually type into ChatGPT, Gemini,
 * Perplexity, or Claude, does this brand surface — and who gets recommended
 * instead? Each keyword is probed against each configured engine; the results
 * roll up into a per-engine and overall visibility score plus a ranked set of
 * gaps to close.
 */

import type { RateEstimate } from "./stats";

/**
 * An answer engine we can probe. `claude` is fully implemented (Anthropic web
 * search); the rest are pluggable and stay inert until their API key is set —
 * see providers.ts. `google` stands in for classic organic / AI Overviews and
 * needs a third-party SERP API, so it is a stub too.
 */
export type AnswerEngine =
  | "claude"
  | "openai"
  | "gemini"
  | "perplexity"
  | "google";

/** Inputs for a visibility run. */
export interface VisibilityQuery {
  /** The site being measured, as an absolute URL or bare domain. */
  domain: string;
  /** Brand/product name to look for in answers. Falls back to the domain. */
  brandName?: string;
  /** The search phrases / questions to check, in priority order. */
  keywords: string[];
}

/**
 * One engine's answer to "for this keyword, does the brand show up?".
 *
 * `present` is the definite signal: true = surfaced/recommended, false =
 * absent, null = we couldn't tell (engine not configured, call failed, or the
 * model was genuinely unsure). A null `present` is excluded from every score so
 * "couldn't check" never reads as "not visible".
 */
export interface EngineVisibility {
  engine: AnswerEngine;
  /** True when the engine's key was set and it was actually queried. */
  configured: boolean;
  present: boolean | null;
  /**
   * 0-100 prominence when present (how central the brand was to the answer),
   * or null when not present / unknown. Lets a passing mention score below a
   * top recommendation.
   */
  prominence: number | null;
  /** Brands or domains the engine surfaced instead, for the fix list. */
  competitors: string[];
  /** One-sentence human-readable evidence, or a failure description. */
  evidence: string | null;
  /**
   * When the engine is probed more than once (see VISIBILITY_SAMPLES),
   * how many probes returned a definite verdict and how many found the brand
   * present. Absent/1 means a single probe. Feeds the credible interval so a
   * lone probe reads as the weak evidence it is.
   */
  samples?: number;
  hits?: number;
}

/** Every engine's verdict for a single keyword, plus its rolled-up score. */
export interface KeywordVisibility {
  keyword: string;
  engines: EngineVisibility[];
  /**
   * 0-100 visibility for this keyword across engines that returned a definite
   * verdict, or null when none did.
   */
  score: number | null;
}

export interface VisibilityReport {
  domain: string;
  brandName: string;
  keywords: KeywordVisibility[];
  /** 0-100 overall, averaged over keywords with a definite score; null if none. */
  overallScore: number | null;
  /**
   * Fraction (0-1) of keyword×engine probes that returned a definite verdict —
   * how much of the intended matrix actually ran.
   */
  coverage: number;
  /** Distinct competitors seen, most-frequently-cited first. */
  topCompetitors: string[];
  /** Highest-impact recommendations, ranked. */
  recommendations: string[];
  /** Engines that ran at least one probe. */
  enginesUsed: AnswerEngine[];
  /**
   * Pooled Beta–Binomial citation-rate estimate across every definite probe in
   * the run, with a 95% credible interval — the honest "how often does this
   * brand actually surface, and how sure are we?" number. Null when no engine
   * returned a definite verdict.
   */
  visibilityRate?: RateEstimate | null;
}
