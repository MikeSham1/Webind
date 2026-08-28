import type { ContentDraftRow } from "@/lib/db/schema";
import type { TuningRow } from "./prompt";
import { seedTuningRows } from "./tuning-seed";
import { buildContentSftDataset, type ContentSftOptions } from "./sft-export";

/**
 * Assemble the full content-writer tuning dataset: the curated best-practices
 * seed first, then our own human-approved drafts (post-cutoff). The seed
 * bootstraps the model on good form; our data supplements it with real,
 * on-brand examples as they accumulate.
 */

export interface TuningDatasetOptions extends ContentSftOptions {
  /** Include the curated best-practices seed. Default true. */
  includeSeed?: boolean;
}

export interface TuningDataset {
  rows: TuningRow[];
  seedCount: number;
  dataCount: number;
}

export function buildContentTuningDataset(
  drafts: ContentDraftRow[],
  opts: TuningDatasetOptions = {},
): TuningDataset {
  const seed = (opts.includeSeed ?? true) ? seedTuningRows() : [];
  const { rows: data } = buildContentSftDataset(drafts, opts);
  return { rows: [...seed, ...data], seedCount: seed.length, dataCount: data.length };
}

/** Serialize rows as JSON Lines — the format Vertex supervised tuning ingests. */
export function toJsonl(rows: TuningRow[]): string {
  if (rows.length === 0) return "";
  return rows.map((r) => JSON.stringify(r)).join("\n") + "\n";
}
