/**
 * Shared training core for the readiness model.
 *
 * A small MLP (F inputs → H tanh hidden → sigmoid) fit by full-batch
 * backprop / gradient descent with L2, standardized inputs, and an 80/20
 * held-out split. Deterministic given the seeds. Used by both trainers:
 *   - train.ts        → the synthetic, Claude-distilled dataset
 *   - train-real.ts   → measured real AI-surfacing outcomes
 * Neither writes the model here; each entry script adds its own version /
 * provenance and writes model.json.
 */

export interface Sample {
  x: number[];
  y: number;
}

export interface TrainOpts {
  hidden?: number;
  epochs?: number;
  lr?: number;
  l2?: number;
  testFrac?: number;
  splitSeed?: number;
  initSeed?: number;
}

export interface TrainedModel {
  arch: { inputs: number; hidden: number; hiddenActivation: "tanh"; output: "sigmoid" };
  standardization: { mean: number[]; std: number[] };
  params: { W1: number[][]; b1: number[]; W2: number[]; b2: number };
  metrics: {
    n: number;
    trainN: number;
    testN: number;
    trainMAE: number;
    testMAE: number;
    testRMSE: number;
    testR2: number;
    baselineTestMAE: number;
  };
}

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

export function trainModel(data: Sample[], opts: TrainOpts = {}): TrainedModel {
  const {
    hidden: H = 16,
    epochs: EPOCHS = 6000,
    lr: LR = 0.15,
    l2: L2 = 1e-4,
    testFrac = 0.2,
    splitSeed = 424242,
    initSeed = 1337,
  } = opts;

  const F = data[0]?.x.length ?? 0;
  if (F === 0) throw new Error("Empty dataset.");
  if (data.some((d) => d.x.length !== F)) {
    throw new Error("Inconsistent feature width across dataset rows.");
  }

  // Shuffle + split (seeded).
  const rows = data.slice();
  const shuf = mulberry32(splitSeed);
  for (let i = rows.length - 1; i > 0; i--) {
    const j = Math.floor(shuf() * (i + 1));
    [rows[i], rows[j]] = [rows[j], rows[i]];
  }
  const splitAt = Math.max(1, Math.floor(rows.length * (1 - testFrac)));
  const train = rows.slice(0, splitAt);
  const test = rows.slice(splitAt);

  // Standardize on train only.
  const mean = new Array(F).fill(0);
  const std = new Array(F).fill(0);
  for (const d of train) for (let k = 0; k < F; k++) mean[k] += d.x[k];
  for (let k = 0; k < F; k++) mean[k] /= train.length;
  for (const d of train) for (let k = 0; k < F; k++) std[k] += (d.x[k] - mean[k]) ** 2;
  for (let k = 0; k < F; k++) std[k] = Math.sqrt(std[k] / train.length) || 1;
  const norm = (x: number[]) => x.map((v, k) => (v - mean[k]) / std[k]);

  const Xtr = train.map((d) => norm(d.x));
  const Ytr = train.map((d) => d.y / 100);
  const Xte = test.map((d) => norm(d.x));
  const Yte = test.map((d) => d.y / 100);

  // Params.
  const init = mulberry32(initSeed);
  const he = (fanIn: number) => (init() * 2 - 1) * Math.sqrt(2 / fanIn);
  const W1 = Array.from({ length: H }, () => Array.from({ length: F }, () => he(F)));
  const b1 = new Array(H).fill(0);
  const W2 = Array.from({ length: H }, () => he(H));
  let b2 = 0;

  const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));
  const forward = (x: number[]) => {
    const a1 = new Array(H);
    for (let h = 0; h < H; h++) {
      let s = b1[h];
      for (let k = 0; k < F; k++) s += W1[h][k] * x[k];
      a1[h] = Math.tanh(s);
    }
    let z2 = b2;
    for (let h = 0; h < H; h++) z2 += W2[h] * a1[h];
    return { a1, yhat: sigmoid(z2) };
  };

  // Train (full-batch GD + L2).
  for (let epoch = 0; epoch < EPOCHS; epoch++) {
    const gW1 = Array.from({ length: H }, () => new Array(F).fill(0));
    const gb1 = new Array(H).fill(0);
    const gW2 = new Array(H).fill(0);
    let gb2 = 0;
    for (let i = 0; i < Xtr.length; i++) {
      const x = Xtr[i];
      const { a1, yhat } = forward(x);
      const dz2 = 2 * (yhat - Ytr[i]) * yhat * (1 - yhat);
      for (let h = 0; h < H; h++) {
        gW2[h] += dz2 * a1[h];
        const dz1 = dz2 * W2[h] * (1 - a1[h] * a1[h]);
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

  const evaluate = (X: number[][], Y: number[]) => {
    let sae = 0;
    let sse = 0;
    for (let i = 0; i < X.length; i++) {
      const p = forward(X[i]).yhat * 100;
      const y = Y[i] * 100;
      sae += Math.abs(p - y);
      sse += (p - y) ** 2;
    }
    const yMean = (Y.reduce((a, b) => a + b, 0) / Y.length) * 100;
    let ssTot = 0;
    for (const y of Y) ssTot += (y * 100 - yMean) ** 2;
    return {
      mae: sae / X.length,
      rmse: Math.sqrt(sse / X.length),
      r2: ssTot > 0 ? 1 - sse / ssTot : 0,
    };
  };

  const trM = evaluate(Xtr, Ytr);
  const teM = test.length > 0 ? evaluate(Xte, Yte) : trM;
  const trainMean = (Ytr.reduce((a, b) => a + b, 0) / Ytr.length) * 100;
  const baseSet = test.length > 0 ? Yte : Ytr;
  const baselineMAE =
    baseSet.reduce((a, y) => a + Math.abs(y * 100 - trainMean), 0) / baseSet.length;

  return {
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
}
