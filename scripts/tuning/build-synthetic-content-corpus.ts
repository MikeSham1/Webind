/**
 * Generate the research-derived synthetic SFT corpus.
 *
 * Requires GOOGLE_CLOUD_PROJECT + Google ADC (or the project's existing Gemini
 * auth) for the Gemini 3.7 teacher. If ANTHROPIC_API_KEY is present, Claude is
 * used as the independent judge; otherwise Gemini judges with a separate prompt.
 *
 * Examples:
 *   npx tsx scripts/tuning/build-synthetic-content-corpus.ts --count=500 --candidates=4
 *   npx tsx scripts/tuning/build-synthetic-content-corpus.ts --count=2000 --out=tuning/v1
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildSyntheticBriefs,
  generateSyntheticExample,
  splitSyntheticExamples,
  tuningRows,
  type SelectedSyntheticExample,
} from "@/lib/content/synthetic-tuning";

function arg(name: string, fallback: string): string {
  const prefix = `--${name}=`;
  return process.argv.find((v) => v.startsWith(prefix))?.slice(prefix.length) ?? fallback;
}

function writeJsonl(path: string, rows: unknown[]) {
  writeFileSync(path, rows.map((row) => JSON.stringify(row)).join("\n") + (rows.length ? "\n" : ""), "utf8");
}

async function main() {
  const count = Math.max(1, Number.parseInt(arg("count", "500"), 10));
  const candidates = Math.max(2, Math.min(8, Number.parseInt(arg("candidates", "4"), 10)));
  const out = arg("out", "tuning/synthetic-v1");
  const seed = arg("seed", "webind-v1");
  const briefs = buildSyntheticBriefs(count, seed);
  const selected: SelectedSyntheticExample[] = [];
  const rejectedBriefIds: string[] = [];

  mkdirSync(out, { recursive: true });

  for (let i = 0; i < briefs.length; i++) {
    const brief = briefs[i];
    const example = await generateSyntheticExample(brief, { candidateCount: candidates });
    if (example) selected.push(example);
    else rejectedBriefIds.push(brief.id);

    if ((i + 1) % 10 === 0 || i + 1 === briefs.length) {
      console.log(`Processed ${i + 1}/${briefs.length}; accepted ${selected.length}`);
    }
  }

  if (selected.length === 0) {
    throw new Error(
      "No synthetic examples were accepted. Check Gemini credentials/model configuration and judge availability.",
    );
  }

  const splits = splitSyntheticExamples(selected);
  writeJsonl(join(out, "train.jsonl"), tuningRows(splits.train));
  writeJsonl(join(out, "validation.jsonl"), tuningRows(splits.validation));
  writeJsonl(join(out, "locked-benchmark.jsonl"), tuningRows(splits.locked));
  writeJsonl(join(out, "provenance.jsonl"), selected.map((example) => ({
    id: example.brief.id,
    slice: example.brief.slice,
    inputs: example.brief.inputs,
    compositeScore: example.winner.compositeScore,
    quality: example.winner.quality,
    judge: example.winner.judge,
    provenance: example.provenance,
  })));
  writeFileSync(join(out, "rejected-briefs.json"), JSON.stringify(rejectedBriefIds, null, 2) + "\n", "utf8");
  writeFileSync(
    join(out, "manifest.json"),
    JSON.stringify({
      requestedBriefs: briefs.length,
      accepted: selected.length,
      rejected: rejectedBriefIds.length,
      candidateCount: candidates,
      seed,
      splits: {
        train: splits.train.length,
        validation: splits.validation.length,
        locked: splits.locked.length,
      },
    }, null, 2) + "\n",
    "utf8",
  );

  console.log(`Corpus written to ${out}`);
  console.log(`  train: ${splits.train.length}`);
  console.log(`  validation: ${splits.validation.length}`);
  console.log(`  locked benchmark: ${splits.locked.length}`);
  console.log(`  rejected briefs: ${rejectedBriefIds.length}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
