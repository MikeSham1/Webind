/**
 * Train the Claude-distilled readiness model.
 *
 * A small multilayer perceptron (25 inputs → 16 tanh hidden units → sigmoid
 * output) trained by real backpropagation / full-batch gradient descent with
 * L2 regularization. A hidden layer is necessary, not decorative: the teacher's
 * multiplicative crawl gates (`base * aiBotGate * renderGate`) are non-linear
 * and a plain linear model cannot represent them.
 *
 * Deterministic (seeded init + seeded split). Reports train/test MAE, R², and a
 * predict-the-mean baseline so the metrics are honest about what was learned.
 * Exports the trained artifact to src/lib/model/model.json.
 *
 *   npx tsx scripts/model/train.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { FEATURE_NAMES } from "../../src/lib/model/features.ts";

const here = dirname(fileURLToPath(import.meta.url));

// --- Load data ---------------------------------------------------------------
const raw = readFileSync(join(here, "dataset.jsonl"), "utf8").trim().split("\n");
const data = raw.map((l) => JSON.parse(l) as { x: number[]; y: number });
const F = FEATURE_NAMES.length;
if (data.some((d) => d.x.length !== F)) {
  throw new Error("Dataset feature width does not match FEATURE_NAMES.");
}

// --- Seeded PRNG (mulberry32) ------------------------------------------------
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(424242);

// --- Shuffle + 80/20 split ---------------------------------------------------
for (let i = data.length - 1; i > 0; i--) {
  const j = Math.floor(rnd() * (i + 1));
  [data[i], data[j]] = [data[j], data[i]];
}
const splitAt = Math.floor(data.length * 0.8);
const train = data.slice(0, splitAt);
const test = data.slice(splitAt);

// --- Standardize inputs (fit on train only) ----------------------------------
const mean = new Array(F).fill(0);
const std = new Array(F).fill(0);
for (const d of train) for (let k = 0; k < F; k++) mean[k] += d.x[k];
for (let k = 0; k < F; k++) mean[k] /= train.length;
for (const d of train)
  for (let k = 0; k < F; k++) std[k] += (d.x[k] - mean[k]) ** 2;
for (let k = 0; k < F; k++) std[k] = Math.sqrt(std[k] / train.length) || 1;

const norm = (x: number[]) => x.map((v, k) => (v - mean[k]) / std[k]);
const Xtr = train.map((d) => norm(d.x));
const Ytr = train.map((d) => d.y / 100); // target in [0,1]
const Xte = test.map((d) => norm(d.x));
const Yte = test.map((d) => d.y / 100);

// --- Model params ------------------------------------------------------------
const H = 16;
const heInit = (fanIn: number) => (rnd() * 2 - 1) * Math.sqrt(2 / fanIn);
const W1 = Array.from({ length: H }, () => Array.from({ length: F }, () => heInit(F)));
const b1 = new Array(H).fill(0);
const W2 = Array.from({ length: H }, () => heInit(H));
let b2 = 0;

const tanh = Math.tanh;
const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));

function forward(x: number[]) {
  const z1 = new Array(H);
  const a1 = new Array(H);
  for (let h = 0; h < H; h++) {
    let s = b1[h];
    for (let k = 0; k < F; k++) s += W1[h][k] * x[k];
    z1[h] = s;
    a1[h] = tanh(s);
  }
  let z2 = b2;
  for (let h = 0; h < H; h++) z2 += W2[h] * a1[h];
  return { a1, yhat: sigmoid(z2) };
}

// --- Training loop (full-batch GD + L2) --------------------------------------
const LR = 0.15;
const L2 = 1e-4;
const EPOCHS = 6000;

for (let epoch = 0; epoch < EPOCHS; epoch++) {
  const gW1 = Array.from({ length: H }, () => new Array(F).fill(0));
  const gb1 = new Array(H).fill(0);
  const gW2 = new Array(H).fill(0);
  let gb2 = 0;

  for (let i = 0; i < Xtr.length; i++) {
    const x = Xtr[i];
    const { a1, yhat } = forward(x);
    // dL/dz2 for MSE on sigmoid output
    const dz2 = 2 * (yhat - Ytr[i]) * yhat * (1 - yhat);
    for (let h = 0; h < H; h++) {
      gW2[h] += dz2 * a1[h];
      const dz1 = dz2 * W2[h] * (1 - a1[h] * a1[h]); // tanh'
      gb1[h] += dz1;
      for (let k = 0; k < F; k++) gW1[h][k] += dz1 * x[k];
    }
    gb2 += dz2;
  }

  const n = Xtr.length;
  for (let h = 0; h < H; h++) {
    W2[h] -= LR * (gW2[h] / n + L2 * W2[h]);
    b1[h] -= LR * (gb1[h] / n);
    for (let k = 0; k < F; k++) W1[h][k] -= LR * (gW1[h][k] / n + L2 * W1[h][k]);
  }
  b2 -= LR * (gb2 / n);
}

// --- Metrics (on 0..100 scale) -----------------------------------------------
function evaluate(X: number[][], Y: number[]) {
  let sae = 0;
  let sse = 0;
  const preds: number[] = [];
  for (let i = 0; i < X.length; i++) {
    const p = forward(X[i]).yhat * 100;
    preds.push(p);
    const y = Y[i] * 100;
    sae += Math.abs(p - y);
    sse += (p - y) ** 2;
  }
  const yMean = (Y.reduce((a, b) => a + b, 0) / Y.length) * 100;
  let ssTot = 0;
  for (const y of Y) ssTot += (y * 100 - yMean) ** 2;
  return { mae: sae / X.length, rmse: Math.sqrt(sse / X.length), r2: 1 - sse / ssTot };
}

const trM = evaluate(Xtr, Ytr);
const teM = evaluate(Xte, Yte);
// Predict-the-mean baseline on the test set (honest floor to beat).
const trainMean = (Ytr.reduce((a, b) => a + b, 0) / Ytr.length) * 100;
const baselineMAE =
  Yte.reduce((a, y) => a + Math.abs(y * 100 - trainMean), 0) / Yte.length;

console.log(`train: MAE ${trM.mae.toFixed(2)}  R² ${trM.r2.toFixed(3)}`);
console.log(`test:  MAE ${teM.mae.toFixed(2)}  R² ${teM.r2.toFixed(3)}  RMSE ${teM.rmse.toFixed(2)}`);
console.log(`baseline (predict mean) test MAE ${baselineMAE.toFixed(2)}`);

// --- Export ------------------------------------------------------------------
const model = {
  version: "distill-2026.08.18",
  generatedAt: new Date().toISOString(),
  provenance:
    "Distilled from Claude's judgment of AI-citability given a page's structural signals. " +
    "Trained on a synthetic feature corpus labeled by the Claude teacher in scripts/model — " +
    "NOT measured real-world citation outcomes. See /methodology.",
  featureNames: FEATURE_NAMES,
  arch: { inputs: F, hidden: H, hiddenActivation: "tanh", output: "sigmoid" },
  standardization: { mean, std },
  params: { W1, b1, W2, b2 },
  metrics: {
    n: data.length,
    trainN: train.length,
    testN: test.length,
    trainMAE: +trM.mae.toFixed(3),
    testMAE: +teM.mae.toFixed(3),
    testRMSE: +teM.rmse.toFixed(3),
    testR2: +teM.r2.toFixed(4),
    baselineTestMAE: +baselineMAE.toFixed(3),
  },
};

const out = join(here, "..", "..", "src", "lib", "model", "model.json");
writeFileSync(out, JSON.stringify(model, null, 2) + "\n");
console.log(`Wrote trained model to ${out}`);
