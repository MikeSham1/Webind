import { crawl as realCrawl } from "@/lib/crawler/crawl";
import { buildReport } from "@/lib/scoring/report";
import type { CrawledPage, ReportResult } from "@/lib/scoring/types";
import { logInfo, logWarn } from "@/lib/log";
import { isSerperConfigured, serperSearch } from "./serper";
import { buildCohort, domainOf } from "./cohort";
import { competitivePercentile } from "./percentile";
import type { BenchmarkReport, CompetitorScore, Percentile } from "./types";

/**
 * Run a competitive benchmark for a page on a query: fetch the SERP, build a
 * rival cohort, crawl and score each rival with the same engine as the target,
 * and report where the target's scores land as competitive percentiles.
 *
 * Dependencies (SERP, crawl, score) are injectable so the whole thing runs
 * offline in tests. Degrades safely: no SERP key → a "not configured" report;
 * any single rival that won't crawl is recorded and skipped, never fatal.
 *
 * Rivals are crawled sequentially — each crawl takes a real browser slot, and a
 * benchmark firing a dozen parallel crawls would starve the live report path.
 */

export interface BenchmarkInput {
  url: string;
  query: string;
  gl?: string;
  hl?: string;
  maxCompetitors?: number;
}

export interface BenchmarkDeps {
  search?: typeof serperSearch;
  crawl?: (url: string) => Promise<CrawledPage>;
  score?: (page: CrawledPage) => ReportResult;
}

export async function runBenchmark(
  input: BenchmarkInput,
  deps: BenchmarkDeps = {},
): Promise<BenchmarkReport> {
  const search = deps.search ?? serperSearch;
  const crawl = deps.crawl ?? realCrawl;
  const score = deps.score ?? buildReport;

  const targetDomain = domainOf(input.url) ?? input.url;
  const base: BenchmarkReport = {
    query: input.query,
    target: { url: input.url, domain: targetDomain, ai: null, traditional: null },
    competitors: [],
    aiPercentile: null,
    traditionalPercentile: null,
    configured: isSerperConfigured() || Boolean(deps.search),
    note: "",
  };

  if (!base.configured) {
    return { ...base, note: "Add SERPER_API_KEY to benchmark against the live search field." };
  }

  const serp = await search(input.query, { gl: input.gl, hl: input.hl });
  if (!serp.ok) {
    return { ...base, note: serp.error };
  }

  const cohort = buildCohort(serp.results, {
    targetDomain,
    max: input.maxCompetitors ?? 12,
  });
  if (cohort.length === 0) {
    return { ...base, note: "No comparable competitors surfaced for that query." };
  }

  // Score the target with the same engine as its rivals.
  const target = await scoreOne(input.url, crawl, score);
  base.target.ai = target.ai;
  base.target.traditional = target.traditional;

  const competitors: CompetitorScore[] = [];
  for (const member of cohort) {
    const scored = await scoreOne(member.url, crawl, score);
    competitors.push({
      url: member.url,
      domain: member.domain,
      position: member.position,
      cohort: member.cohort,
      ai: scored.ai,
      traditional: scored.traditional,
      ok: scored.ok,
      error: scored.error,
    });
  }

  const aiPercentile = percentileFor(target.ai, competitors, (c) => c.ai);
  const traditionalPercentile = percentileFor(
    target.traditional,
    competitors,
    (c) => c.traditional,
  );

  const okCount = competitors.filter((c) => c.ok).length;
  logInfo("benchmark.ok", {
    query: input.query,
    cohort: cohort.length,
    scored: okCount,
  });

  return {
    ...base,
    competitors,
    aiPercentile,
    traditionalPercentile,
    note:
      okCount === 0
        ? "Found competitors, but none could be crawled to score."
        : `Ranked against ${okCount} of ${competitors.length} competitors that surfaced for this query.`,
  };
}

interface OneScore {
  ai: number | null;
  traditional: number | null;
  ok: boolean;
  error?: string;
}

/** Crawl + score a single URL, turning any failure into a null-scored result. */
async function scoreOne(
  url: string,
  crawl: (url: string) => Promise<CrawledPage>,
  score: (page: CrawledPage) => ReportResult,
): Promise<OneScore> {
  try {
    const report = score(await crawl(url));
    return { ai: report.ai.total, traditional: report.traditional.total, ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logWarn("benchmark.crawl_failed", { url, error: message });
    return { ai: null, traditional: null, ok: false, error: message };
  }
}

/** Percentile of `value` across the competitors that scored on this dimension. */
function percentileFor(
  value: number | null,
  competitors: CompetitorScore[],
  pick: (c: CompetitorScore) => number | null,
): Percentile | null {
  if (value === null) return null;
  const cohort = competitors
    .map(pick)
    .filter((v): v is number => v !== null);
  return competitivePercentile(value, cohort);
}
