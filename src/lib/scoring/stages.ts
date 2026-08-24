import type { ReportResult, SignalScore } from "./types";

/**
 * Stage-specific scores — modeling the actual AI-visibility pipeline instead of
 * collapsing everything into one "AI readiness" scalar.
 *
 * 2026 research (the July 2026 review of 45 GEO studies; SAGEO Arena) is clear
 * that generative visibility is multistage — crawling → retrieval → citation →
 * authority → user behavior — and that optimizing one stage in isolation can
 * hurt an earlier one. A single number hides exactly the tradeoff that matters,
 * so we surface the vector underneath the headline score.
 *
 * Each stage also carries a CONFIDENCE: the fraction of that stage's signal
 * weight we actually measured. Off-page signals (backlinks, brand mentions) are
 * unmeasured on the free report, so the authority stage is honestly low-
 * confidence rather than silently renormalized to look complete. Confidence is
 * meant to travel with the score, never be hidden behind it.
 *
 * This is a pure derivation from the signals a report already contains — no
 * new crawl, no stored field — so it works for any past or future report.
 */

export type StageKey =
  | "searchEligibility"
  | "retrievalRelevance"
  | "evidenceCitation"
  | "authorityTrust"
  | "userValue";

export interface StageScore {
  key: StageKey;
  label: string;
  question: string;
  /** 0-100 over measured signals in this stage, or null if none were measured. */
  score: number | null;
  /** 0-1: share of this stage's signal weight that was actually measured. */
  confidence: number;
}

/**
 * Which signals feed each stage. Keys reference the signal `key`s produced by
 * the scoring engine (AI + traditional). A signal can only sit in one stage —
 * the pipeline stage it most directly gates.
 */
const STAGE_DEFS: {
  key: StageKey;
  label: string;
  question: string;
  signals: string[];
}[] = [
  {
    key: "searchEligibility",
    label: "Search Eligibility",
    question: "Can the page be crawled, rendered, and understood at all?",
    signals: ["aiCrawlability", "technicalSeo"],
  },
  {
    key: "retrievalRelevance",
    label: "Retrieval Relevance",
    question: "Does the page deserve to be retrieved for its topic?",
    signals: ["topicalAuthority", "answerability", "freshness"],
  },
  {
    key: "evidenceCitation",
    label: "Evidence & Citation Readiness",
    question: "Once retrieved, is there distinctive, attributable information to cite?",
    signals: ["factDensity", "schema"],
  },
  {
    key: "authorityTrust",
    label: "Authority & Trust",
    question: "What entity, reputation, and source-quality evidence exists?",
    signals: ["eeat", "backlinks", "brandMentions"],
  },
  {
    key: "userValue",
    label: "User Value",
    question: "Does the page satisfy the intent once it's surfaced?",
    signals: ["contentQuality", "onPageOptimization"],
  },
];

function computeStage(
  def: (typeof STAGE_DEFS)[number],
  byKey: Map<string, SignalScore>,
): StageScore {
  let weighted = 0;
  let measuredWeight = 0;
  let totalWeight = 0;
  for (const sigKey of def.signals) {
    const s = byKey.get(sigKey);
    if (!s) continue;
    totalWeight += s.weight;
    if (s.score !== null) {
      weighted += s.score * s.weight;
      measuredWeight += s.weight;
    }
  }
  return {
    key: def.key,
    label: def.label,
    question: def.question,
    score: measuredWeight > 0 ? Math.round(weighted / measuredWeight) : null,
    confidence: totalWeight > 0 ? measuredWeight / totalWeight : 0,
  };
}

/** Derive the five-stage vector from a completed report's signals. */
export function computeStages(report: ReportResult): StageScore[] {
  const byKey = new Map<string, SignalScore>();
  for (const s of [...report.ai.signals, ...report.traditional.signals]) {
    byKey.set(s.key, s);
  }
  return STAGE_DEFS.map((def) => computeStage(def, byKey));
}
