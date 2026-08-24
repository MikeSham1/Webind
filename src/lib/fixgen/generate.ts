import { generate } from "../ai/generator";
import type { AiProvider, GenerateResult } from "../ai/types";
import { FIX_GENERATOR_SYSTEM, serializeContext } from "./prompt";
import { validateCandidate, type ValidationResult } from "./validators";
import type {
  Confidence,
  FixApplyVia,
  FixCandidate,
  FixCategory,
  FixContextPackage,
  NoFixReason,
} from "./types";

/**
 * Turn a validated context package into reviewed fix candidates.
 *
 * Provider-neutral: the model only proposes; deterministic validators decide
 * what a human is ever allowed to see. A malformed response, a fallback (no
 * key / provider error), or candidates that fail validation all degrade safely
 * — never throw, never surface an ungrounded fix.
 */

const APPLY_VIA: Record<FixCategory, FixApplyVia> = {
  metadata: "github-snippet",
  schema: "github-snippet",
  crawlability: "github-file",
  "content-structure": "manual",
};

const CONFIDENCES = new Set<Confidence>(["high", "medium", "low"]);
const NO_FIX_REASONS = new Set<NoFixReason>([
  "already_optimal",
  "not_applicable",
  "insufficient_evidence",
  "low_expected_value",
  "conflicts_with_page_intent",
  "requires_site_level_change",
  "requires_external_information",
  "unsafe_to_automate",
]);

export interface GeneratedFix {
  candidate: FixCandidate;
  result: ValidationResult;
}

export interface GenerateFixesOutcome {
  /** Candidates that passed every hard validator — the only ones fit for review. */
  accepted: FixCandidate[];
  /** Candidates that failed validation, kept for observability/training signal. */
  rejected: GeneratedFix[];
  /** The raw generation call (provider/model/tokens/fallback). */
  generation: GenerateResult;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v : null;
}

/** Coerce one raw model object into a FixCandidate, filling deterministic fields. */
function toCandidate(raw: unknown, i: number, ctx: FixContextPackage): FixCandidate {
  const o = (raw ?? {}) as Record<string, unknown>;
  const action = o.action === "no_fix" ? "no_fix" : "fix";
  const category = ctx.allowedCategory; // never trust the model's category
  const confidence = CONFIDENCES.has(o.confidence as Confidence)
    ? (o.confidence as Confidence)
    : "low";
  const noFixReason =
    action === "no_fix" && NO_FIX_REASONS.has(o.noFixReason as NoFixReason)
      ? (o.noFixReason as NoFixReason)
      : action === "no_fix"
        ? "not_applicable"
        : null;
  const ids = Array.isArray(o.evidenceSpanIds)
    ? o.evidenceSpanIds.filter((x): x is string => typeof x === "string")
    : [];

  return {
    candidateId: `c${i + 1}`,
    action,
    category: action === "fix" ? category : null,
    target: action === "fix" ? str(o.target) : null,
    before: str(o.before),
    after: action === "fix" ? str(o.after) : null,
    rationale: str(o.rationale) ?? "",
    evidenceSpanIds: ids,
    confidence,
    applyVia: action === "fix" ? APPLY_VIA[category] : null,
    noFixReason,
  };
}

function parseCandidates(text: string, ctx: FixContextPackage): FixCandidate[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  const arr = (parsed as { candidates?: unknown })?.candidates;
  if (!Array.isArray(arr)) return [];
  return arr.slice(0, 3).map((raw, i) => toCandidate(raw, i, ctx));
}

export async function generateFixes(
  ctx: FixContextPackage,
  opts: { provider?: AiProvider } = {},
): Promise<GenerateFixesOutcome> {
  const generation = await generate(
    {
      system: FIX_GENERATOR_SYSTEM,
      prompt: serializeContext(ctx),
      json: true,
      purpose: "fix_generate",
      maxOutputTokens: 2048,
    },
    opts,
  );

  if (generation.fallback) {
    return { accepted: [], rejected: [], generation };
  }

  const candidates = parseCandidates(generation.text, ctx);
  const accepted: FixCandidate[] = [];
  const rejected: GeneratedFix[] = [];
  for (const candidate of candidates) {
    const result = validateCandidate(candidate, ctx);
    if (result.ok) accepted.push(candidate);
    else rejected.push({ candidate, result });
  }
  return { accepted, rejected, generation };
}
