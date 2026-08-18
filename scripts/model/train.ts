/**
 * Train the Claude-distilled readiness model on the synthetic teacher dataset.
 *
 * Thin entry point over train-core: loads scripts/model/dataset.jsonl, trains
 * the shared MLP, and writes src/lib/model/model.json with distillation
 * provenance. Deterministic.
 *
 *   npx tsx scripts/model/train.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { FEATURE_NAMES } from "../../src/lib/model/features.ts";
import { trainModel, type Sample } from "./train-core.ts";

const here = dirname(fileURLToPath(import.meta.url));
const raw = readFileSync(join(here, "dataset.jsonl"), "utf8").trim().split("\n");
const data = raw.map((l) => JSON.parse(l) as Sample);
if (data.some((d) => d.x.length !== FEATURE_NAMES.length)) {
  throw new Error("Dataset feature width does not match FEATURE_NAMES.");
}

const trained = trainModel(data);
const m = trained.metrics;
console.log(`train: MAE ${m.trainMAE}  (n=${m.trainN})`);
console.log(`test:  MAE ${m.testMAE}  R² ${m.testR2}  RMSE ${m.testRMSE}  (n=${m.testN})`);
console.log(`baseline (predict mean) test MAE ${m.baselineTestMAE}`);

const model = {
  version: "distill-2026.08.18",
  generatedAt: new Date().toISOString(),
  trainedOn: "synthetic-distillation",
  provenance:
    "Distilled from Claude's judgment of AI-citability given a page's structural signals. " +
    "Trained on a synthetic feature corpus labeled by the Claude teacher in scripts/model — " +
    "NOT measured real-world citation outcomes. See /methodology.",
  featureNames: FEATURE_NAMES,
  ...trained,
};

const out = join(here, "..", "..", "src", "lib", "model", "model.json");
writeFileSync(out, JSON.stringify(model, null, 2) + "\n");
console.log(`Wrote trained model to ${out}`);
