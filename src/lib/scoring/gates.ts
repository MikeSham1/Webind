import type { AppliedCap, CrawledPage } from "./types";

/**
 * Authority fundamentals — the gating checklist.
 *
 * The weighted signal average answers "how much of the good stuff does this
 * page have?". But authority is not purely additive: the domains that sit at
 * the top of every authority scale share a set of table-stakes fundamentals
 * (reachable, crawlable, secure, substantive, clearly identified). Failing one
 * of those is DISQUALIFYING, not merely one weak input among many — a page AI
 * crawlers can't read cannot be cited no matter how good its content is.
 *
 * So each fundamental, when failed, imposes a hard CEILING on the score. The
 * final total is min(weighted score, lowest ceiling among the failed gates).
 * A cap can only lower a score, never raise it, and a page that clears every
 * fundamental is never touched.
 *
 * The ceilings are reasoned (like the weights): the more disqualifying the
 * failure, the lower the ceiling. They are documented so they can be tuned as
 * real citation-outcome data arrives.
 */
export interface Gate {
  id: string;
  label: string;
  passed: boolean;
  /** Ceiling imposed on the score when this gate fails. */
  ceiling: number;
  fix: string;
}

/** Minimum words for a page to count as substantive rather than a stub. */
const MIN_SUBSTANTIVE_WORDS = 150;

/**
 * Fundamentals for AI readiness: can an answer engine find, read, and treat
 * this page as a citable source at all?
 */
export function aiGates(page: CrawledPage): Gate[] {
  return [
    {
      id: "reachable",
      label: "Page returns a 200 status",
      passed: page.statusCode === 200,
      ceiling: 30,
      fix: "Return a 200 status — an erroring or redirecting page can't be crawled or cited.",
    },
    {
      id: "renderable",
      label: "Main content is server-rendered",
      passed: page.hasServerRenderedContent,
      ceiling: 50,
      fix: "Server-render the main content — AI crawlers run little JavaScript, so a JS-only shell is mostly invisible to them.",
    },
    {
      id: "crawlable",
      label: "AI search crawlers are allowed",
      passed: page.robotsAllowsAiBots,
      ceiling: 40,
      fix: "Unblock AI search crawlers in robots.txt — while they're blocked the page cannot be cited at all.",
    },
    {
      id: "substantive",
      label: "Enough content to answer",
      passed: page.wordCount >= MIN_SUBSTANTIVE_WORDS,
      ceiling: 55,
      fix: "Add substantive content — the page is too thin to serve as a citable answer.",
    },
  ];
}

/**
 * Fundamentals for traditional search authority: can a search engine index,
 * trust, and rank this page?
 */
export function traditionalGates(page: CrawledPage): Gate[] {
  const hasTitle = page.title !== null && page.title.trim() !== "";
  return [
    {
      id: "reachable",
      label: "Page returns a 200 status",
      passed: page.statusCode === 200,
      ceiling: 30,
      fix: "Return a 200 status — an erroring page won't be indexed or ranked.",
    },
    {
      id: "secure",
      label: "Served over HTTPS",
      passed: page.url.startsWith("https://"),
      ceiling: 65,
      fix: "Serve the site over HTTPS — it's a baseline trust and ranking signal that every authoritative site meets.",
    },
    {
      id: "identified",
      label: "Has a descriptive title",
      passed: hasTitle,
      ceiling: 55,
      fix: "Add a descriptive <title> — it's the primary ranking target for the page.",
    },
    {
      id: "substantive",
      label: "Enough content to rank",
      passed: page.wordCount >= MIN_SUBSTANTIVE_WORDS,
      ceiling: 60,
      fix: "Add substantive content — a near-empty page has nothing to rank.",
    },
  ];
}

/** The failed gates, as caps for the report (empty when all pass). */
export function failedCaps(gates: Gate[]): AppliedCap[] {
  return gates
    .filter((g) => !g.passed)
    .map(({ id, label, ceiling, fix }) => ({ id, label, ceiling, fix }));
}

/**
 * Apply the caps to a weighted total: the final score can't exceed the lowest
 * ceiling among the failed fundamentals. Caps only ever lower a score.
 */
export function capTotal(weighted: number, caps: AppliedCap[]): number {
  if (caps.length === 0) return weighted;
  const ceiling = Math.min(...caps.map((c) => c.ceiling));
  return Math.min(weighted, ceiling);
}
