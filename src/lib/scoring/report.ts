import type { CrawledPage, ReportResult, SignalScore } from "./types";
import { scoreAiAuthority, scoreTraditionalAuthority } from "./authority";
import { SCORING_MODEL_VERSION } from "./weights";

/**
 * Ranking priority: high-weight, low-scoring signals surface first. Unmeasured
 * signals rank last (they carry no fix, so they are filtered out before this).
 */
function priority(s: SignalScore): number {
  if (s.score === null) return -1;
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

  return { url: page.url, ai, traditional, prioritizedFixes, modelVersion: SCORING_MODEL_VERSION };
}
