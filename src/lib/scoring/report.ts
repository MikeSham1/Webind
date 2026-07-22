import type { CrawledPage, ReportResult, SignalScore } from "./types";
import { scoreAiAuthority, scoreTraditionalAuthority } from "./authority";

/** Ranking priority: high-weight, low-scoring signals surface first. */
function priority(s: SignalScore): number {
  return s.weight * (100 - s.score);
}

export function buildReport(page: CrawledPage): ReportResult {
  const ai = scoreAiAuthority(page);
  const traditional = scoreTraditionalAuthority(page);

  const prioritizedFixes = [...ai.signals, ...traditional.signals]
    .filter((s): s is SignalScore & { fix: string } => s.fix !== null)
    // Rank by priority; break ties by key so ordering is deterministic by
    // design rather than by array insertion order.
    .sort((a, b) => priority(b) - priority(a) || a.key.localeCompare(b.key))
    .map((s) => s.fix);

  return { url: page.url, ai, traditional, prioritizedFixes };
}
