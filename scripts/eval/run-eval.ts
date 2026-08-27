/**
 * Run the locked eval suite against a generator and print the bake-off metrics.
 *
 * Same cases, any provider — compare Claude vs Gemini 3.7 vs a future tuned
 * Gemini 3.5 on the hard promotion gates (acceptance, unsupported-claim rate,
 * evidence coverage). These locked cases are eval-only and MUST NOT be exported
 * for training.
 *
 *   GEMINI_API_KEY=... FIX_GENERATOR_PROVIDER=gemini npx tsx scripts/eval/run-eval.ts
 *   ANTHROPIC_API_KEY=... FIX_GENERATOR_PROVIDER=anthropic npx tsx scripts/eval/run-eval.ts
 */
import { makePage } from "@/lib/scoring/test-fixtures";
import { selectProvider } from "@/lib/ai/generator";
import { runSuite, type EvalCase } from "@/lib/eval/harness";

// A tiny locked set. Metadata cases reliably require a fix; the product case
// exercises the no_fix path (a page that already has its content-type schema).
const CASES: EvalCase[] = [
  {
    id: "meta-generic-missing",
    site: "acme.example",
    pageType: "generic",
    category: "metadata",
    riskClass: "low",
    page: makePage({
      url: "https://acme.example/widgets",
      metaDescription: null,
      title: "Acme Widgets — Durable Widgets for Small Business",
      renderedText:
        "Acme makes durable widgets for small businesses. Compare models, read setup guides, and find the right widget for your team.",
    }),
  },
  {
    id: "meta-thin",
    site: "brightpath.example",
    pageType: "generic",
    category: "metadata",
    riskClass: "low",
    page: makePage({
      url: "https://brightpath.example/pricing",
      metaDescription: "Pricing.",
      title: "BrightPath Pricing — Plans for Every Team Size",
      renderedText:
        "BrightPath offers Starter, Team, and Enterprise plans. Each plan includes onboarding and support. Compare features across plans.",
    }),
  },
  {
    id: "schema-product-already-present",
    site: "shopgear.example",
    pageType: "product",
    category: "schema",
    riskClass: "low",
    page: makePage({
      url: "https://shopgear.example/trail-pack",
      jsonLdBlocks: [{ "@type": "Product", name: "Trail Pack 30L" }],
      title: "Trail Pack 30L",
    }),
  },
];

async function main() {
  const provider = selectProvider();
  console.log(`Provider: ${provider.name} (${provider.model}), configured: ${provider.isConfigured()}`);
  console.log(`Running ${CASES.length} locked cases…\n`);

  const { results, summary } = await runSuite(provider, CASES);
  for (const r of results) {
    const tag = r.fallback ? "FALLBACK" : r.noFix ? "no_fix" : `accepted ${r.accepted}, rejected ${r.rejected}`;
    console.log(
      `  ${r.caseId} [${r.category}]: ${tag}` +
        (r.noFix || r.fallback ? "" : `, evidence coverage ${(r.evidenceCoverage * 100).toFixed(0)}%`),
    );
  }
  console.log("\nSummary:");
  console.log(`  cases:                 ${summary.cases}`);
  console.log(`  fallback rate:         ${(summary.fallbackRate * 100).toFixed(0)}%`);
  console.log(`  no_fix rate:           ${(summary.noFixRate * 100).toFixed(0)}%`);
  console.log(`  mean accepted/case:    ${summary.meanAccepted.toFixed(2)}`);
  console.log(`  unsupported claims:    ${summary.totalUnsupportedClaims}`);
  console.log(`  mean evidence covg:    ${(summary.meanEvidenceCoverage * 100).toFixed(0)}%`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
