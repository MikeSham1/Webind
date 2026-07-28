/**
 * Signal weights, grounded in 2026 GEO/AEO research.
 *
 * AI Authority is now dominated by the levers that actually move AI citations:
 * E-E-A-T/trust (96% of AI-Overview citations have strong E-E-A-T; unauthored
 * pages ~40% less cited), structural answerability (lists +30% for Claude, FAQ
 * +28-40%, 44% of citations come from the first 30% of a page), and fact
 * density (Princeton's single strongest method, +41%). Schema, AI-crawlability
 * and freshness round it out. Brand mentions are off-page — kept as a small
 * weight, measured only when the live AI-citation check runs.
 *
 * Traditional Authority leans on measurable on-page quality/technical signals,
 * with backlinks retained as the one honest off-page unknown.
 */

export const AI_WEIGHTS = {
  eeat: 0.2,
  answerability: 0.18,
  factDensity: 0.16,
  schema: 0.14,
  aiCrawlability: 0.12,
  freshness: 0.12,
  brandMentions: 0.08,
} as const;

export const TRADITIONAL_WEIGHTS = {
  contentQuality: 0.24,
  technicalSeo: 0.22,
  topicalAuthority: 0.18,
  onPageOptimization: 0.14,
  backlinks: 0.22,
} as const;
