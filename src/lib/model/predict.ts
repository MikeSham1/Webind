import type { CrawledPage } from "../scoring/types";
import { extractFeatures, FEATURE_NAMES } from "./features";
import modelJson from "./model.json";

/**
 * Inference for the Claude-distilled readiness model.
 *
 * Loads the trained artifact (src/lib/model/model.json) and runs the same
 * forward pass the trainer used: standardize inputs, one tanh hidden layer,
 * sigmoid output, scaled to 0..100. Pure and deterministic — the same page
 * always yields the same score.
 *
 * This is an experimental model distilled from Claude's *judgment* of
 * structural AI-citability signals, not from measured real-world citations.
 * It runs alongside — never replaces — the transparent heuristic scores.
 */

const model = modelJson as {
  version: string;
  provenance: string;
  featureNames: string[];
  standardization: { mean: number[]; std: number[] };
  params: { W1: number[][]; b1: number[]; W2: number[]; b2: number };
  metrics: { testMAE: number; testR2: number; baselineTestMAE: number };
};

// Guard against a features/model drift at load time rather than silently
// scoring against a mismatched vector.
if (model.featureNames.length !== FEATURE_NAMES.length) {
  throw new Error(
    `Model feature width (${model.featureNames.length}) != FEATURE_NAMES (${FEATURE_NAMES.length}). Retrain.`,
  );
}

export const MODEL_VERSION = model.version;
export const MODEL_META = {
  version: model.version,
  provenance: model.provenance,
  testMAE: model.metrics.testMAE,
  testR2: model.metrics.testR2,
  baselineTestMAE: model.metrics.baselineTestMAE,
};

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

/** Predicted AI-readiness (0..100) for a crawled page, from the trained model. */
export function predictReadiness(page: CrawledPage): number {
  const { mean, std } = model.standardization;
  const { W1, b1, W2, b2 } = model.params;

  const x = extractFeatures(page).map((v, k) => (v - mean[k]) / std[k]);

  const H = W1.length;
  let z2 = b2;
  for (let h = 0; h < H; h++) {
    let s = b1[h];
    const row = W1[h];
    for (let k = 0; k < x.length; k++) s += row[k] * x[k];
    z2 += W2[h] * Math.tanh(s);
  }
  const yhat = 1 / (1 + Math.exp(-z2)); // sigmoid → [0,1]
  return Math.round(clamp(yhat * 100, 0, 100));
}
