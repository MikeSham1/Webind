import type { AppliedCap, CrawledPage } from "./types";
import { classifyPageType, type PageType } from "./page-type";

/**
 * Authority fundamentals — the gating checklist.
 *
 * The weighted signal average answers "how much of the good stuff does this
 * page have?". But authority is not purely additive: some failures are
 * DISQUALIFYING, not merely one weak input among many. A page Googlebot is
 * blocked from can't rank on Google however good its content is; a page every
 * AI search crawler is blocked from can't be cited by AI search. Averaging
 * those failures in lets strong content signals paper over them — a page could
 * score in the 70s while being invisible.
 *
 * So each fundamental, when failed, imposes a hard CEILING on the score. The
 * final total is min(weighted score, lowest ceiling among the failed gates).
 * A cap can only lower a score, never raise it, and a page that clears every
 * fundamental is never touched.
 *
 * The ceilings are reasoned (like the weights in weights.ts): the more
 * disqualifying the failure, the lower the ceiling. They're documented on
 * /methodology so they can be tuned as real citation-outcome data arrives.
 */
export interface GateDefinition {
  id: string;
  label: string;
  /** Ceiling imposed on the score when this gate fails. */
  ceiling: number;
  fix: string;
  /**
   * The signal whose fix also lifts this cap, when one exists. Fix ranking
   * floats that signal to the top instead of repeating the advice.
   */
  signal?: string;
  /** Page types this gate applies to; omitted = every type. */
  appliesTo?: PageType[];
  passes: (page: CrawledPage) => boolean;
}

/** Minimum words for a page to count as substantive rather than a stub. */
const MIN_SUBSTANTIVE_WORDS = 150;

/**
 * Homepages and category/listing pages are navigation hubs whose substance
 * lives on the pages behind them, so a short one isn't a stub the way a short
 * article or product page is.
 */
const CONTENT_PAGE_TYPES: PageType[] = ["article", "product", "other"];

const AI_SEARCH_CRAWLERS = ["openaiSearch", "anthropicSearch", "perplexitySearch"] as const;

const reachable = (page: CrawledPage) => page.statusCode === 200;
const substantive = (page: CrawledPage) => page.wordCount >= MIN_SUBSTANTIVE_WORDS;

/**
 * Fundamentals for AI readiness: can an answer engine find, read, and treat
 * this page as a citable source at all?
 */
export const AI_GATES: GateDefinition[] = [
  {
    id: "reachable",
    label: "Page returns a 200 status",
    ceiling: 30,
    fix: "Return a 200 status — an erroring page can't be crawled or cited.",
    passes: reachable,
  },
  {
    // Fails only when EVERY AI search crawler is blocked. Blocking one engine
    // is a real but partial gap, already priced in by the AI Crawlability
    // signal; it doesn't make the page uncitable everywhere.
    id: "crawlable",
    label: "AI search crawlers can reach it",
    ceiling: 40,
    fix:
      "Unblock AI search crawlers (OAI-SearchBot, Claude-SearchBot, PerplexityBot) " +
      "in robots.txt — while all of them are blocked, AI search can't cite the page.",
    signal: "aiCrawlability",
    passes: (page) => !AI_SEARCH_CRAWLERS.every((k) => page.crawlerAccess[k] === "blocked"),
  },
  {
    id: "renderable",
    label: "Main content is server-rendered",
    ceiling: 50,
    fix:
      "Server-render the main content — AI crawlers run little JavaScript, so a " +
      "JS-only shell is mostly invisible to them.",
    signal: "aiCrawlability",
    passes: (page) => page.hasServerRenderedContent,
  },
  {
    id: "substantive",
    label: "Enough content to answer from",
    ceiling: 55,
    fix: "Add substantive content — the page is too thin to serve as a citable answer.",
    signal: "contentQuality",
    appliesTo: CONTENT_PAGE_TYPES,
    passes: substantive,
  },
];

/**
 * Fundamentals for traditional search authority: can a search engine index,
 * trust, and rank this page?
 */
export const TRADITIONAL_GATES: GateDefinition[] = [
  {
    id: "reachable",
    label: "Page returns a 200 status",
    ceiling: 30,
    fix: "Return a 200 status — an erroring page won't be indexed or ranked.",
    passes: reachable,
  },
  {
    id: "indexable",
    label: "Googlebot can crawl it",
    ceiling: 30,
    fix:
      "Stop blocking Googlebot in robots.txt — while it's blocked, Google can't " +
      "read the page, so it can't rank on its content.",
    // "unknown" (robots.txt unreachable) passes: we only cap what we observed.
    passes: (page) => page.crawlerAccess.googleSearch !== "blocked",
  },
  {
    id: "identified",
    label: "Has a descriptive title",
    ceiling: 55,
    fix: "Add a descriptive <title> — it's the primary ranking target for the page.",
    signal: "technicalSeo",
    passes: (page) => page.title !== null && page.title.trim() !== "",
  },
  {
    id: "substantive",
    label: "Enough content to rank",
    ceiling: 60,
    fix: "Add substantive content — a near-empty page has nothing to rank.",
    signal: "contentQuality",
    appliesTo: CONTENT_PAGE_TYPES,
    passes: substantive,
  },
  {
    id: "secure",
    label: "Served over HTTPS",
    ceiling: 65,
    fix:
      "Serve the site over HTTPS — it's a baseline trust and ranking signal " +
      "every authoritative site meets.",
    signal: "technicalSeo",
    passes: (page) => page.url.startsWith("https://"),
  },
];

/** The gates this page fails, as caps for the report (empty when all pass). */
export function failedCaps(gates: GateDefinition[], page: CrawledPage): AppliedCap[] {
  const type = classifyPageType(page);
  return gates
    .filter((g) => !g.appliesTo || g.appliesTo.includes(type))
    .filter((g) => !g.passes(page))
    .map(({ id, label, ceiling, fix, signal }) => ({
      id,
      label,
      ceiling,
      fix,
      ...(signal ? { signal } : {}),
    }));
}

/**
 * Apply caps to a weighted total: the final score can't exceed the lowest
 * ceiling among the failed fundamentals. Caps only ever lower a score.
 */
export function capTotal(weighted: number, caps: AppliedCap[]): number {
  if (caps.length === 0) return weighted;
  return Math.min(weighted, ...caps.map((c) => c.ceiling));
}

/** The cap actually binding the total (the lowest ceiling), or null. */
export function bindingCap(caps: AppliedCap[] | undefined): AppliedCap | null {
  if (!caps || caps.length === 0) return null;
  return caps.reduce((lo, c) => (c.ceiling < lo.ceiling ? c : lo));
}
