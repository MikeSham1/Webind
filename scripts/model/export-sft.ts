/**
 * Export the Gemini SFT dataset from human-approved fix reviews.
 *
 * Trains ONLY on accepted (unedited or edited-final) reviews and reviewed
 * no_fix; never on rejected/unreviewed/synthetic output. Refuses to write below
 * SFT_MIN_EXAMPLES — WeBind deliberately uses a high bar because the generator
 * affects customer content. Output is git-ignored (customer-derived).
 *
 *   DATABASE_URL=... npx tsx scripts/model/export-sft.ts [--include-major-edits]
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { listReviewedExamples } from "@/lib/fixgen/store";
import { buildSftDataset } from "@/lib/fixgen/sft-export";

const MIN = Number(process.env.SFT_MIN_EXAMPLES || 50);

async function main() {
  const examples = await listReviewedExamples();
  if (examples.length === 0) {
    console.error(
      "No reviewed examples found. Ensure DATABASE_URL is set and that fixes have " +
        "actually been reviewed (accepted/edited) first.",
    );
    process.exit(1);
  }

  const { rows, provenance } = buildSftDataset(examples, {
    includeMajorEdits: process.argv.includes("--include-major-edits"),
  });
  console.log(`${examples.length} reviewed examples → ${rows.length} eligible training rows.`);

  if (rows.length < MIN) {
    console.error(
      `Only ${rows.length} eligible (< SFT_MIN_EXAMPLES=${MIN}). Collect more accepted ` +
        `reviews before tuning — a small SFT set on customer-affecting output is not worth ` +
        `the risk. Nothing written.`,
    );
    process.exit(1);
  }

  const here = dirname(fileURLToPath(import.meta.url));
  writeFileSync(join(here, "sft-dataset.jsonl"), rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
  writeFileSync(
    join(here, "sft-provenance.jsonl"),
    provenance.map((p) => JSON.stringify(p)).join("\n") + "\n",
  );
  console.log(
    `Wrote ${rows.length} rows to scripts/model/sft-dataset.jsonl (git-ignored).\n` +
      `Provenance in scripts/model/sft-provenance.jsonl. Upload the dataset to GCS and run a\n` +
      `Gemini 3.5 Flash tuning job (see scripts/model/README).`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
