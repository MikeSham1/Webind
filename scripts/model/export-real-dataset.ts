/**
 * Export a REAL-outcome training set from stored Keyword Visibility results.
 *
 * This is the ground-truth half of the loop: every visibility run records
 * whether an AI answer engine actually surfaced the brand (visibility_outcomes).
 * Here we turn those measured outcomes into (page-features → real-visibility)
 * training rows by crawling each domain once and pairing its structural feature
 * vector with its coverage-weighted measured score.
 *
 * Requires DATABASE_URL (to read outcomes) and a working crawler (Chromium).
 * Refuses to write a dataset below MIN_DOMAINS — an honest guard so nobody
 * "retrains on real data" from three data points.
 *
 *   DATABASE_URL=... npx tsx scripts/model/export-real-dataset.ts
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { listVisibilityOutcomes } from "@/lib/visibility/store";
import { MIN_COVERAGE } from "@/lib/visibility/outcome-label";
import { extractFeatures, FEATURE_NAMES } from "@/lib/model/features";
import { crawl } from "@/lib/crawler/crawl";
import { normalizeUrl, BlockedUrlError } from "@/lib/crawler/ssrf";

/** Won't emit a dataset with fewer usable domains than this. */
const MIN_DOMAINS = 40;

async function main() {
  const rows = await listVisibilityOutcomes();
  if (rows.length === 0) {
    console.error(
      "No visibility outcomes stored yet. Run some Keyword Visibility checks first " +
        "(and confirm DATABASE_URL points at the right database).",
    );
    process.exit(1);
  }

  // Aggregate to one coverage-weighted label per domain (multiple checks over
  // time collapse into a single, more stable target).
  const byDomain = new Map<string, { wsum: number; w: number }>();
  for (const r of rows) {
    if (r.overallScore === null || r.coverageBps === null) continue;
    const coverage = r.coverageBps / 1000;
    if (coverage < MIN_COVERAGE) continue;
    const acc = byDomain.get(r.domain) ?? { wsum: 0, w: 0 };
    acc.wsum += r.overallScore * coverage;
    acc.w += coverage;
    byDomain.set(r.domain, acc);
  }

  const domains = [...byDomain.entries()]
    .map(([domain, a]) => ({ domain, label: a.wsum / a.w }))
    .filter((d) => Number.isFinite(d.label));

  console.log(
    `${rows.length} stored outcomes → ${domains.length} distinct domains with a usable label.`,
  );

  // Crawl each domain once for its current feature vector.
  const samples: { x: number[]; y: number }[] = [];
  for (const { domain, label } of domains) {
    const url = normalizeUrl(domain);
    if (!url) {
      console.warn(`  skip ${domain}: not a valid URL`);
      continue;
    }
    try {
      const page = await crawl(url);
      samples.push({ x: extractFeatures(page), y: label });
      console.log(`  ✓ ${domain} (label ${label.toFixed(1)})`);
    } catch (err) {
      const why = err instanceof BlockedUrlError ? err.message : "crawl failed";
      console.warn(`  skip ${domain}: ${why}`);
    }
  }

  if (samples.length < MIN_DOMAINS) {
    console.error(
      `\nOnly ${samples.length} usable (features+label) samples — need at least ${MIN_DOMAINS} ` +
        `to train an honest real-outcome model. Collect more visibility outcomes and re-run. ` +
        `Nothing written.`,
    );
    process.exit(1);
  }

  const here = dirname(fileURLToPath(import.meta.url));
  const out = join(here, "real-dataset.jsonl");
  if (samples.some((s) => s.x.length !== FEATURE_NAMES.length)) {
    throw new Error("Feature width mismatch — regenerate after a FEATURE_NAMES change.");
  }
  writeFileSync(out, samples.map((s) => JSON.stringify(s)).join("\n") + "\n");
  const ys = samples.map((s) => s.y);
  console.log(
    `\nWrote ${samples.length} real-outcome samples to ${out}\n` +
      `Label mean ${(ys.reduce((a, b) => a + b, 0) / ys.length).toFixed(1)}, ` +
      `min ${Math.min(...ys).toFixed(1)}, max ${Math.max(...ys).toFixed(1)}\n` +
      `Next: npx tsx scripts/model/train-real.ts`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
