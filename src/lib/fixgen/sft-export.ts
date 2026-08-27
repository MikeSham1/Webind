import { FIX_GENERATOR_SYSTEM, serializeContext } from "./prompt";
import {
  buildMetaDescriptionContext,
  buildSchemaContext,
  type ContextOrNoFix,
} from "./context";
import type { PageSnapshot } from "./snapshot";
import type { ReviewedExample } from "./store";

/**
 * Supervised fine-tuning export for a future Gemini 3.5 Flash tuning run.
 *
 * Eligibility is the whole point — we train ONLY on human-approved targets and
 * NEVER on rejected, unreviewed, or synthetic output. The training target is the
 * human's final text (on an edit), not the model's original. Each row is bound
 * to its snapshot, and the user turn is rebuilt deterministically from that
 * snapshot so the (context → approved output) pair is faithful. Nothing here
 * fabricates examples; an empty review set yields an empty dataset.
 */

export interface SftRow {
  systemInstruction: { parts: { text: string }[] };
  contents: { role: "user" | "model"; parts: { text: string }[] }[];
}

export interface SftProvenance {
  reviewId: string;
  runId: string;
  snapshotId: string;
  decision: string;
  promptVersion: string;
  generatorModel: string;
}

export interface SftExportOptions {
  /** accepted_major_edit is excluded unless explicitly opted in (quality review). */
  includeMajorEdits?: boolean;
}

const BUILDERS: Record<string, (s: PageSnapshot) => ContextOrNoFix> = {
  metadata: buildMetaDescriptionContext,
  schema: buildSchemaContext,
};

/** The approved output the model should be taught to produce, or null if ineligible. */
function trainingTarget(ex: ReviewedExample, includeMajor: boolean): string | null {
  if (!ex.decision.startsWith("accepted")) return null; // rejected / skipped / anything else
  if (ex.decision === "accepted_major_edit" && !includeMajor) return null;

  const c = ex.candidate;
  if (c.action === "no_fix") {
    return JSON.stringify({ candidates: [{ action: "no_fix", noFixReason: c.noFixReason }] });
  }

  const after = ex.decision === "accepted_unedited" ? c.after : ex.humanFinal ?? c.after;
  if (!after) return null;
  return JSON.stringify({
    candidates: [
      {
        action: "fix",
        category: c.category,
        target: c.target,
        before: c.before,
        after,
        rationale: c.rationale,
        evidenceSpanIds: c.evidenceSpanIds,
        confidence: c.confidence,
        noFixReason: null,
      },
    ],
  });
}

/** Build one SFT row + provenance, or null when the example is ineligible. */
export function buildSftRow(
  ex: ReviewedExample,
  opts: SftExportOptions = {},
): { row: SftRow; provenance: SftProvenance } | null {
  const target = trainingTarget(ex, opts.includeMajorEdits ?? false);
  if (target === null || !ex.snapshot) return null;

  const build = BUILDERS[ex.category];
  if (!build) return null;
  const gate = build(ex.snapshot);
  // If the stored snapshot no longer warrants this fix, the context can't be
  // reconstructed faithfully — skip rather than train on a mismatched pair.
  if (gate.kind !== "context") return null;

  return {
    row: {
      systemInstruction: { parts: [{ text: FIX_GENERATOR_SYSTEM }] },
      contents: [
        { role: "user", parts: [{ text: serializeContext(gate.context) }] },
        { role: "model", parts: [{ text: target }] },
      ],
    },
    provenance: {
      reviewId: ex.reviewId,
      runId: ex.runId,
      snapshotId: ex.snapshotId,
      decision: ex.decision,
      promptVersion: ex.promptVersion,
      generatorModel: ex.generatorModel,
    },
  };
}

/** Build the full eligible dataset (rows + provenance), skipping every ineligible example. */
export function buildSftDataset(
  examples: ReviewedExample[],
  opts: SftExportOptions = {},
): { rows: SftRow[]; provenance: SftProvenance[] } {
  const rows: SftRow[] = [];
  const provenance: SftProvenance[] = [];
  for (const ex of examples) {
    const built = buildSftRow(ex, opts);
    if (built) {
      rows.push(built.row);
      provenance.push(built.provenance);
    }
  }
  return { rows, provenance };
}
