import type { ContentDraftRow } from "@/lib/db/schema";
import { toTuningRow, type TuningRow } from "./prompt";

/**
 * Supervised fine-tuning export for the content writer.
 *
 * Eligibility is the whole point: we train ONLY on drafts a human APPROVED, and
 * NEVER on rejected or still-pending ones. The training target is the human's
 * edited final when they changed it, otherwise the approved markdown. Nothing
 * here fabricates examples — an empty/ineligible set yields an empty dataset.
 */

/**
 * Do not include collected data dated before this cutoff in a tuning run.
 * (Per project decision 2026-08-28.) Applies to our own drafts; the curated
 * best-practices seed is undated instructional content and is separate.
 */
export const TUNING_DATA_CUTOFF = new Date("2026-10-01T00:00:00Z");

export interface ContentSftProvenance {
  draftId: string;
  status: string;
  edited: boolean;
  createdAt: Date;
}

export interface ContentSftOptions {
  /** Earliest draft date to include. Defaults to {@link TUNING_DATA_CUTOFF}. */
  since?: Date;
}

/** The approved target for a draft, or null when it's ineligible. */
function trainingTarget(draft: ContentDraftRow): string | null {
  if (draft.status !== "approved") return null; // rejected / pending → never a target
  const text = (draft.humanFinal ?? draft.markdown ?? "").trim();
  return text || null;
}

/** Build one tuning row + provenance from an approved draft, or null. */
export function buildContentSftRow(
  draft: ContentDraftRow,
  opts: ContentSftOptions = {},
): { row: TuningRow; provenance: ContentSftProvenance } | null {
  const since = opts.since ?? TUNING_DATA_CUTOFF;
  if (draft.createdAt < since) return null; // exclude pre-cutoff data
  if (!draft.inputs) return null; // can't reconstruct the brief

  const target = trainingTarget(draft);
  if (target === null) return null;

  return {
    row: toTuningRow(draft.inputs, target),
    provenance: {
      draftId: draft.id,
      status: draft.status,
      edited: Boolean(draft.humanFinal),
      createdAt: draft.createdAt,
    },
  };
}

/** Build the eligible dataset from approved drafts, skipping every ineligible one. */
export function buildContentSftDataset(
  drafts: ContentDraftRow[],
  opts: ContentSftOptions = {},
): { rows: TuningRow[]; provenance: ContentSftProvenance[] } {
  const rows: TuningRow[] = [];
  const provenance: ContentSftProvenance[] = [];
  for (const draft of drafts) {
    const built = buildContentSftRow(draft, opts);
    if (built) {
      rows.push(built.row);
      provenance.push(built.provenance);
    }
  }
  return { rows, provenance };
}
