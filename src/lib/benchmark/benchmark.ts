import { crawl as realCrawl } from "@/lib/crawler/crawl";
import { buildReport } from "@/lib/scoring/report";
import type { CrawledPage, ReportResult } from "@/lib/scoring/types";
import { logInfo, logWarn } from "@/lib/log";
import { isSerperConfigured, serperSearch } from "./serper";
import { buildCohort, domainOf, type CohortMember } from "./cohort";
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
 * A full run (SERP + target + up to a dozen rival crawls) can take minutes, so
 * it's resumable: pass `resume` with whatever was already completed (see
 * BenchmarkProgress) and this skips straight past that work — the SERP call
 * isn't repeated and already-scored rivals aren't re-crawled. `onProgress`
 * fires after each unit of work completes, so a caller can persist it; if the
 * whole process dies mid-run (a timeout, a crash) before onProgress's caller
 * marks the run finished, whatever was last persisted is exactly what the next
 * call should resume from.
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

/** Everything already completed toward a run, so it can pick up where it left off. */
export interface BenchmarkProgress {
  /** null = the SERP call (and cohort build) hasn't happened yet. */
  cohort: CohortMember[] | null;
  /** null = the target itself hasn't been crawled/scored yet. */
  target: { ai: number | null; traditional: number | null } | null;
  /** Rivals already crawled and scored, in cohort order. */
  competitors: CompetitorScore[];
}

export const EMPTY_BENCHMARK_PROGRESS: BenchmarkProgress = {
  cohort: null,
  target: null,
  competitors: [],
};

export async function runBenchmark(
  input: BenchmarkInput,
  deps: BenchmarkDeps = {},
  resume: BenchmarkProgress = EMPTY_BENCHMARK_PROGRESS,
  onProgress?: (progress: BenchmarkProgress) => Promise<void> | void,
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

  let cohort = resume.cohort;
  if (!cohort) {
    const serp = await search(input.query, { gl: input.gl, hl: input.hl });
    if (!serp.ok) {
      return { ...base, note: serp.error };
    }
    cohort = buildCohort(serp.results, {
      targetDomain,
      max: input.maxCompetitors ?? 12,
    });
    await onProgress?.({ cohort, target: resume.target, competitors: resume.competitors });
  }
  if (cohort.length === 0) {
    return { ...base, note: "No comparable competitors surfaced for that query." };
  }

  // Score the target with the same engine as its rivals — skipped on resume.
  let target = resume.target;
  if (!target) {
    const scored = await scoreOne(input.url, crawl, score);
    target = { ai: scored.ai, traditional: scored.traditional };
    await onProgress?.({ cohort, target, competitors: resume.competitors });
  }
  base.target.ai = target.ai;
  base.target.traditional = target.traditional;

  const competitors: CompetitorScore[] = [...resume.competitors];
  const alreadyScored = new Set(competitors.map((c) => c.url));
  for (const member of cohort) {
    if (alreadyScored.has(member.url)) continue;
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
    await onProgress?.({ cohort, target, competitors });
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
