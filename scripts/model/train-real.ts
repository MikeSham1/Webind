/**
 * Retrain the readiness model on REAL measured AI-surfacing outcomes.
 *
 * Reads scripts/model/real-dataset.jsonl (produced by export-real-dataset.ts),
 * trains the shared MLP, and writes src/lib/model/model.json — promoting the
 * real-outcome model into the app in place of the Claude-distilled one. Uses
 * stronger regularization and a smaller hidden layer than the synthetic
 * trainer, since real datasets start small and overfit easily.
 *
 * Refuses below MIN_SAMPLES: an honest guard against "trained on real data"
 * that's really three points of noise.
 *
 *   npx tsx scripts/model/train-real.ts
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { FEATURE_NAMES } from "../../src/lib/model/features.ts";
import { trainModel, type Sample } from "./train-core.ts";

const MIN_SAMPLES = 40;

const here = dirname(fileURLToPath(import.meta.url));
const dataPath = join(here, "real-dataset.jsonl");

if (!existsSync(dataPath)) {
  console.error(
    `No real-dataset.jsonl found. Run 'npx tsx scripts/model/export-real-dataset.ts' first ` +
      `(it needs stored visibility outcomes + DATABASE_URL).`,
  );
  process.exit(1);
}

const data = readFileSync(dataPath, "utf8")
  .trim()
  .split("\n")
  .filter(Boolean)
  .map((l) => JSON.parse(l) as Sample);

if (data.length < MIN_SAMPLES) {
  console.error(
    `Only ${data.length} real samples — need at least ${MIN_SAMPLES}. Collect more visibility ` +
      `outcomes and re-export. Nothing written.`,
  );
  process.exit(1);
}
if (data.some((d) => d.x.length !== FEATURE_NAMES.length)) {
  throw new Error("Real dataset feature width does not match FEATURE_NAMES.");
}

// Smaller net + stronger L2 for a small real dataset.
const trained = trainModel(data, { hidden: 8, l2: 1e-3, epochs: 5000 });
const m = trained.metrics;
console.log(`train: MAE ${m.trainMAE}  (n=${m.trainN})`);
console.log(`test:  MAE ${m.testMAE}  R² ${m.testR2}  RMSE ${m.testRMSE}  (n=${m.testN})`);
console.log(`baseline (predict mean) test MAE ${m.baselineTestMAE}`);
if (m.testMAE >= m.baselineTestMAE) {
  console.warn(
    "\n⚠  The model does not beat the predict-the-mean baseline on held-out data. " +
      "With this little/this noisy real data it hasn't learned a generalizable signal yet — " +
      "collect more outcomes before promoting it. Writing anyway so you can inspect it.",
  );
}

const today = new Date().toISOString().slice(0, 10);
const model = {
  version: `real-${today}`,
  generatedAt: new Date().toISOString(),
  trainedOn: "real-visibility-outcomes",
  provenance:
    "Trained on MEASURED AI-surfacing outcomes: each label is a real Keyword Visibility " +
    "result (did an answer engine actually surface the brand), paired with the page's " +
    "structural features. Calibrated to real outcomes, not Claude's judgment. See /methodology.",
  featureNames: FEATURE_NAMES,
  ...trained,
};

const out = join(here, "..", "..", "src", "lib", "model", "model.json");
writeFileSync(out, JSON.stringify(model, null, 2) + "\n");
console.log(`\nWrote REAL-outcome model to ${out} (version ${model.version}).`);
console.log("The app now scores with this model. Commit model.json to deploy it.");
