/**
 * Build the content-writer supervised-tuning dataset as JSONL.
 *
 * Combines the curated best-practices seed with our own human-APPROVED drafts
 * (excluding anything dated before the TUNING_DATA_CUTOFF, 2026-10-01). Writes
 * a .jsonl file ready to upload to a Vertex AI supervised-tuning job.
 *
 *   npx tsx scripts/tuning/build-content-dataset.ts [outfile]
 *
 * With no DATABASE_URL it emits the seed only (still a valid starter dataset).
 * The actual tuning run is a Vertex job you trigger — this only prepares data.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { listAllDrafts } from "@/lib/content/store";
import { buildContentTuningDataset, toJsonl } from "@/lib/content/tuning";
import { TUNING_DATA_CUTOFF } from "@/lib/content/sft-export";

async function main() {
  const outfile = process.argv[2] ?? "tuning/content-dataset.jsonl";

  // listAllDrafts returns [] when the DB isn't configured, so seed-only works.
  const drafts = await listAllDrafts();
  const dataset = buildContentTuningDataset(drafts);

  mkdirSync(dirname(outfile), { recursive: true });
  writeFileSync(outfile, toJsonl(dataset.rows), "utf8");

  console.log(`Wrote ${dataset.rows.length} rows to ${outfile}`);
  console.log(`  seed (curated best practices): ${dataset.seedCount}`);
  console.log(`  approved drafts (>= ${TUNING_DATA_CUTOFF.toISOString().slice(0, 10)}): ${dataset.dataCount}`);
  if (dataset.dataCount === 0) {
    console.log("  (no eligible collected drafts yet — seed-only dataset)");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
