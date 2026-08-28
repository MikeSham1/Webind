import type { Cohort, SerpResult } from "./types";

/**
 * Turn raw SERP results into a clean competitive cohort:
 *  - drop the target's own domain (we're benchmarking against *rivals*),
 *  - drop non-web results and obvious non-competitors (aggregators like Google
 *    itself, YouTube) that aren't comparable pages,
 *  - dedupe by registrable domain, keeping each domain's best position,
 *  - label positions 1-10 "top" and 11-30 "near" (near-miss), and
 *  - cap the total so one run can't crawl an unbounded number of sites.
 */

/** Hosts that surface in SERPs but aren't comparable competitor pages. */
const NON_COMPETITOR_HOSTS = new Set([
  "google.com",
  "youtube.com",
  "maps.google.com",
  "translate.google.com",
]);

/** Registrable-ish domain: hostname minus a leading www. Lowercased. */
export function domainOf(url: string): string | null {
  try {
    const u = /^https?:\/\//i.test(url) ? url : `https://${url}`;
    return new URL(u).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

function cohortFor(position: number): Cohort | null {
  if (position >= 1 && position <= 10) return "top";
  if (position >= 11 && position <= 30) return "near";
  return null;
}

export interface CohortMember {
  url: string;
  domain: string;
  position: number;
  cohort: Cohort;
}

export interface BuildCohortOptions {
  /** The target's domain, excluded from its own competitive field. */
  targetDomain: string;
  /** Max competitors to keep (bounds crawl cost). Default 12. */
  max?: number;
}

/** Build a deduped, capped competitor cohort from SERP results. */
export function buildCohort(
  results: SerpResult[],
  opts: BuildCohortOptions,
): CohortMember[] {
  const target = opts.targetDomain.toLowerCase().replace(/^www\./, "");
  const max = opts.max ?? 12;

  const byDomain = new Map<string, CohortMember>();
  for (const r of results) {
    const domain = domainOf(r.link);
    if (!domain) continue;
    if (domain === target) continue;
    if (NON_COMPETITOR_HOSTS.has(domain)) continue;
    const cohort = cohortFor(r.position);
    if (!cohort) continue;

    const existing = byDomain.get(domain);
    // Keep the best (lowest) position per domain.
    if (!existing || r.position < existing.position) {
      byDomain.set(domain, { url: r.link, domain, position: r.position, cohort });
    }
  }

  return [...byDomain.values()]
    .sort((a, b) => a.position - b.position)
    .slice(0, max);
}
