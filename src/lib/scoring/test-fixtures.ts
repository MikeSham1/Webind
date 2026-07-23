import type { CrawledPage } from "./types";

/** ISO timestamp `n` days before now — handy for freshness fixtures. */
export const daysAgo = (n: number) =>
  new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();

/** A healthy baseline CrawledPage; pass overrides to model deficiencies. */
export function makePage(overrides: Partial<CrawledPage> = {}): CrawledPage {
  return {
    url: "https://example.com/",
    fetchedAt: new Date().toISOString(),
    statusCode: 200,
    html: "<html></html>",
    renderedText: "Some visible text",
    title: "Example Title",
    metaDescription: "An example meta description.",
    metaAuthor: "Jane Doe",
    headings: [{ level: 1, text: "Main" }],
    jsonLdBlocks: [],
    outboundLinks: [
      "https://en.wikipedia.org/wiki/Widget",
      "https://www.reuters.com/article",
    ],
    wordCount: 700,
    hasServerRenderedContent: true,
    robotsAllowsAiBots: true,
    hasLlmsTxt: true,
    lastModified: daysAgo(10),
    lastModifiedSource: "json-ld",
    ...overrides,
  };
}
