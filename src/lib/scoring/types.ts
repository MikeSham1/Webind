export interface CrawledPage {
  url: string;
  fetchedAt: string; // ISO timestamp
  statusCode: number;
  html: string; // raw HTML as served (pre-JS)
  renderedText: string; // visible text after render
  title: string | null;
  metaDescription: string | null;
  headings: { level: number; text: string }[];
  jsonLdBlocks: unknown[]; // parsed application/ld+json blocks
  wordCount: number;
  hasServerRenderedContent: boolean;
  robotsAllowsAiBots: boolean;
  hasLlmsTxt: boolean;
  lastModified: string | null; // ISO
}

export interface SignalScore {
  key: string;
  label: string;
  score: number;
  weight: number;
  reason: string;
  fix: string | null;
}

export interface AuthorityScore {
  total: number;
  signals: SignalScore[];
}

export interface ReportResult {
  url: string;
  ai: AuthorityScore;
  traditional: AuthorityScore;
  prioritizedFixes: string[];
}
