import type { CrawledPage } from "../scoring/types";
import type { AiProvider } from "../ai/types";
import { buildSnapshot } from "../fixgen/snapshot";
import {
  buildMetaDescriptionContext,
  buildSchemaContext,
  type ContextOrNoFix,
} from "../fixgen/context";
import { generateFixes } from "../fixgen/generate";

/**
 * Provider-neutral evaluation harness — the bake-off.
 *
 * Runs the SAME locked cases against any generator (Claude, Gemini 3.7, a future
 * tuned Gemini 3.5) and reports HARD, deterministic metrics: acceptance,
 * unsupported-claim rate, evidence coverage, no_fix, and fallback. These are the
 * promotion gates. Quality/preference metrics (faithfulness, human pairwise)
 * are a separate human/LLM-judge layer — never BLEU/ROUGE — and are not
 * computed here. Locked eval cases must never appear in any training export.
 */

export type EvalCategory = "metadata" | "schema";

export interface EvalCase {
  id: string;
  /** Segmentation fields, so results can be sliced by site/type/risk. */
  site: string;
  pageType: string;
  category: EvalCategory;
  riskClass: "low" | "medium" | "high";
  page: CrawledPage;
}

export interface EvalCaseResult {
  caseId: string;
  category: EvalCategory;
  provider: string;
  model: string;
  fallback: boolean;
  noFix: boolean;
  accepted: number;
  rejected: number;
  /** Rejected specifically for an unsupported/fabricated factual claim. */
  unsupportedClaims: number;
  /** Fraction of accepted candidates that cite at least one evidence span. */
  evidenceCoverage: number;
}

const BUILDERS: Record<EvalCategory, (s: ReturnType<typeof buildSnapshot>) => ContextOrNoFix> = {
  metadata: buildMetaDescriptionContext,
  schema: buildSchemaContext,
};

/** Run one case against one provider. Never throws (a fallback is a result). */
export async function runCase(
  provider: AiProvider,
  c: EvalCase,
): Promise<EvalCaseResult> {
  const base: EvalCaseResult = {
    caseId: c.id,
    category: c.category,
    provider: provider.name,
    model: provider.model,
    fallback: false,
    noFix: false,
    accepted: 0,
    rejected: 0,
    unsupportedClaims: 0,
    evidenceCoverage: 0,
  };

  const gate = BUILDERS[c.category](buildSnapshot(c.page));
  if (gate.kind === "no_fix") return { ...base, noFix: true };

  const outcome = await generateFixes(gate.context, { provider });
  if (outcome.generation.fallback) {
    return { ...base, fallback: true, model: outcome.generation.model };
  }

  const accepted = outcome.accepted.length;
  const withEvidence = outcome.accepted.filter((x) => x.evidenceSpanIds.length > 0).length;
  const unsupported = outcome.rejected.filter((r) =>
    r.result.failures.some((f) => /unsupported factual|cites no evidence/.test(f)),
  ).length;

  return {
    ...base,
    model: outcome.generation.model,
    noFix: accepted === 0 && outcome.rejected.length === 0,
    accepted,
    rejected: outcome.rejected.length,
    unsupportedClaims: unsupported,
    evidenceCoverage: accepted > 0 ? withEvidence / accepted : 1,
  };
}

export interface EvalSummary {
  provider: string;
  cases: number;
  fallbackRate: number;
  noFixRate: number;
  /** Mean accepted candidates per generated (non-fallback, non-no_fix) case. */
  meanAccepted: number;
  totalUnsupportedClaims: number;
  meanEvidenceCoverage: number;
}

/** Aggregate per-case results into provider-level metrics for comparison. */
export function summarize(provider: string, results: EvalCaseResult[]): EvalSummary {
  const n = results.length || 1;
  const generated = results.filter((r) => !r.fallback && !r.noFix);
  const g = generated.length || 1;
  return {
    provider,
    cases: results.length,
    fallbackRate: results.filter((r) => r.fallback).length / n,
    noFixRate: results.filter((r) => r.noFix).length / n,
    meanAccepted: generated.reduce((a, r) => a + r.accepted, 0) / g,
    totalUnsupportedClaims: results.reduce((a, r) => a + r.unsupportedClaims, 0),
    meanEvidenceCoverage:
      generated.reduce((a, r) => a + r.evidenceCoverage, 0) / g,
  };
}

/** Run every case against a provider, in sequence (respects provider rate limits). */
export async function runSuite(
  provider: AiProvider,
  cases: EvalCase[],
): Promise<{ results: EvalCaseResult[]; summary: EvalSummary }> {
  const results: EvalCaseResult[] = [];
  for (const c of cases) results.push(await runCase(provider, c));
  return { results, summary: summarize(provider.name, results) };
}
