/**
 * Generate the distillation training set.
 *
 * Samples a realistic corpus of page feature vectors (features correlated
 * around a latent "quality" level, plus the two independent crawl gates), then
 * labels each with the Claude teacher (`teacherLabel`) plus small Gaussian
 * label noise so the model must generalize rather than memorize the formula.
 *
 * Reproducible: everything is driven by a fixed-seed PRNG. Re-running produces
 * byte-identical output. Writes JSONL to scripts/model/dataset.jsonl.
 *
 *   npx tsx scripts/model/generate-dataset.ts
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { FEATURE_NAMES, type FeatureName } from "../../src/lib/model/features.ts";
import { teacherLabel } from "../../src/lib/model/teacher.ts";

const SEED = 20260818;
const N = 700;

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

const rnd = mulberry32(SEED);
const gauss = (mean: number, sd: number) => {
  // Box-Muller
  const u1 = Math.max(1e-9, rnd());
  const u2 = rnd();
  return mean + sd * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
};
const bern = (p: number) => (rnd() < p ? 1 : 0);
const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

function sampleExample(): { x: number[]; y: number } {
  // Latent quality drives most positive signals; the two crawl gates are
  // sampled mostly-on but independently so the model sees their effect.
  const q = rnd();

  const wordCount = clamp(Math.round(gauss(q * 1800 + 120, 350)), 0, 4000);
  const paragraphCount = clamp(
    Math.round(wordCount / 90 + gauss(0, 3)),
    0,
    80,
  );
  const named: Record<FeatureName, number> = {
    wordCount,
    paragraphCount,
    longParagraphRatio: clamp(gauss((1 - q) * 0.45, 0.12), 0, 0.9),
    headingCount: clamp(Math.round(gauss(q * 11, 2.5)), 0, 30),
    hasH2: bern(clamp(0.2 + q * 0.7, 0, 0.97)),
    listItemCount: Math.max(0, Math.round(gauss(q * 14, 5))),
    tableCount: Math.max(0, Math.round(gauss(q * 1.5, 1))),
    blockquoteCount: Math.max(0, Math.round(gauss(q * 1.2, 1))),
    schemaBlockCount: Math.max(0, Math.round(gauss(q * 2.2, 1))),
    hasOrgOrWebsiteSchema: bern(clamp(q * 0.85, 0, 0.95)),
    hasLlmsTxt: bern(clamp(0.05 + q * 0.2, 0, 0.4)),
    robotsAllowsAiBots: bern(0.8), // independent gate
    hasServerRenderedContent: bern(0.85), // independent gate
    internalLinkCount: Math.max(0, Math.round(gauss(q * 28, 8))),
    outboundLinkCount: Math.max(0, Math.round(gauss(q * 7, 3))),
    hasAboutOrContactLink: bern(clamp(0.15 + q * 0.75, 0, 0.95)),
    altRatio: rnd() < 0.15 ? 1 : clamp(gauss(q, 0.2), 0, 1),
    hasCanonical: bern(clamp(0.25 + q * 0.65, 0, 0.95)),
    hasOpenGraph: bern(clamp(0.2 + q * 0.7, 0, 0.95)),
    hasViewportMeta: bern(clamp(0.5 + q * 0.45, 0, 0.98)),
    hasHtmlLang: bern(clamp(0.4 + q * 0.5, 0, 0.95)),
    titleLen: rnd() < 0.08 ? 0 : clamp(Math.round(gauss(52, 18)), 0, 120),
    metaDescLen: rnd() < 0.25 ? 0 : clamp(Math.round(gauss(30 + q * 130, 40)), 0, 260),
    hasAuthor: bern(clamp(q * 0.6, 0, 0.85)),
    hasLastModified: bern(clamp(0.2 + q * 0.6, 0, 0.9)),
  };

  const x = FEATURE_NAMES.map((n) => named[n]);
  const y = clamp(teacherLabel(x) + gauss(0, 3), 0, 100);
  return { x, y };
}

const rows: { x: number[]; y: number }[] = [];
for (let i = 0; i < N; i++) rows.push(sampleExample());

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "dataset.jsonl");
writeFileSync(out, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");

const ys = rows.map((r) => r.y);
const mean = ys.reduce((a, b) => a + b, 0) / ys.length;
const min = Math.min(...ys);
const max = Math.max(...ys);
console.log(`Wrote ${rows.length} examples to ${out}`);
console.log(
  `Label distribution — mean ${mean.toFixed(1)}, min ${min.toFixed(1)}, max ${max.toFixed(1)}`,
);
