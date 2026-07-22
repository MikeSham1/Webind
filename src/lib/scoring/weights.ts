export const AI_WEIGHTS = {
  eeat: 0.3,
  brandMentions: 0.25,
  schema: 0.15,
  aiCrawlability: 0.15,
  freshness: 0.15,
} as const;

export const TRADITIONAL_WEIGHTS = {
  backlinks: 0.3,
  topicalAuthority: 0.25,
  technicalSeo: 0.2,
  contentQuality: 0.15,
  engagement: 0.1,
} as const;
