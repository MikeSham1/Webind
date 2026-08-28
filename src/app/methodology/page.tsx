import type { Metadata } from "next";
import Link from "next/link";
import { AI_WEIGHTS, TRADITIONAL_WEIGHTS, SCORING_MODEL_VERSION } from "@/lib/scoring/weights";
import { MODEL_META } from "@/lib/model/predict";

export const metadata: Metadata = {
  title: "Methodology — WeBind Design",
  description: "How WeBind's AI Readiness and Traditional Authority scores are built, and what they don't yet measure.",
  // Pre-launch: keep the whole site out of search indexes (see root layout).
  robots: { index: false, follow: false, nocache: true },
};

const AI_LABELS: Record<keyof typeof AI_WEIGHTS, { label: string; note: string }> = {
  eeat: {
    label: "E-E-A-T Signals",
    note: "Who's behind the site and whether it's trustworthy: Organization/WebSite schema, an about/contact page, official social profiles, cited authoritative sources, and named authorship. Judged from one page, so on a homepage a missing author byline isn't penalized — bylines live on the article pages a single-page scan can't see; there we read entity identity instead.",
  },
  answerability: {
    label: "Answer-ready Structure",
    note: "Lists, tables, question-style headings, and scannable prose that let a model lift a passage cleanly. We score the structure, not FAQ markup: Google removed FAQ rich results in 2026 and needs no special schema for AI Search, so FAQPage schema earns nothing here.",
  },
  factDensity: {
    label: "Evidence Integrity",
    note: "Whether the page's factual claims are actually supported — each verifiable figure cited to a source in place, not just numbers stacked up. We grade supported-claim coverage, not raw statistic count, because newer evaluations found 'add more stats' unreliable while genuinely backing claims tracks what engines cite. (Verifying that a cited source truly supports its claim is a further step we don't yet perform.)",
  },
  schema: {
    label: "Schema Markup",
    note: "Structured data (JSON-LD) that lets a model parse what a page is about without inferring it from prose.",
  },
  aiCrawlability: {
    label: "AI Crawlability",
    note: "Whether the page is server-rendered (AI crawlers run little JS) and whether AI search crawlers are allowed in robots.txt. llms.txt is NOT scored — the major engines say it neither helps nor hurts, so we don't manufacture a deficiency from its absence.",
  },
  freshness: {
    label: "Content Freshness",
    note: "A machine-readable last-modified date. How much recency matters is topic-dependent, so we decay gently and never all the way to zero.",
  },
  brandMentions: {
    label: "Brand Mentions (off-page)",
    note: "Whether the brand is actually surfaced when an AI model is asked about the topic — measured only by the separate, live Keyword Visibility check, not the free report.",
  },
};

const TRAD_LABELS: Record<keyof typeof TRADITIONAL_WEIGHTS, { label: string; note: string }> = {
  contentQuality: {
    label: "Content Quality",
    note: "Whether the page is substantive enough to actually answer its topic, plus structure and readability. There is no ideal length, so past a not-too-thin floor, more words earn nothing.",
  },
  technicalSeo: {
    label: "Technical SEO",
    note: "Canonical tags, viewport meta, HTML lang, and other on-page technical hygiene.",
  },
  topicalAuthority: {
    label: "Topical Authority",
    note: "Whether the page covers one subject in depth: heading structure, internal linking to related pages, and topical focus — how consistently the page's own core terms (from its title and H1) recur across its headings and body, rather than a topic named once in passing.",
  },
  onPageOptimization: {
    label: "On-page Optimization",
    note: "Title and meta description quality, image alt text, Open Graph tags.",
  },
  backlinks: {
    label: "Backlinks (off-page)",
    note: "Not measured — a real backlink profile needs a third-party index we don't have access to yet. Always shown as unmeasured, never guessed.",
  },
};

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

export default function MethodologyPage() {
  return (
    <main className="mx-auto w-full max-w-2xl px-6 py-14">
      <Link
        href="/"
        className="font-mono text-xs uppercase tracking-[0.16em] text-muted hover:text-accent"
      >
        ← WeBind Design
      </Link>

      <div className="mt-6">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted">
          Methodology · v{SCORING_MODEL_VERSION}
        </p>
        <h1 className="mt-2 font-display text-3xl font-semibold text-ink">
          How the scores are built
        </h1>
        <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-muted">
          Every report carries the version of the model that produced it, so
          a score you saved last month stays traceable even after the weights
          below change.
        </p>
      </div>

      <section className="mt-10 space-y-4">
        <h2 className="font-display text-lg font-semibold text-ink">
          AI Readiness (weights sum to 100%)
        </h2>
        <p className="text-[15px] leading-relaxed text-muted">
          Measures how ready a page is to be understood and cited by an AI
          model — structure, evidence, and trust signals that 2026 GEO/AEO
          research ties to AI citation rates. It does not measure whether any
          AI model currently recommends you; that is a live, separate check
          (see below).
        </p>
        <dl className="space-y-3">
          {Object.entries(AI_WEIGHTS).map(([key, weight]) => {
            const meta = AI_LABELS[key as keyof typeof AI_WEIGHTS];
            return (
              <div key={key} className="rounded-xl border border-line bg-surface p-4">
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="font-sans text-sm font-semibold text-ink">{meta.label}</dt>
                  <dd className="font-mono text-xs text-accent">{pct(weight)}</dd>
                </div>
                <p className="mt-1.5 text-sm leading-relaxed text-muted">{meta.note}</p>
              </div>
            );
          })}
        </dl>
      </section>

      <section className="mt-10 space-y-4">
        <h2 className="font-display text-lg font-semibold text-ink">
          Traditional Authority (weights sum to 100%)
        </h2>
        <p className="text-[15px] leading-relaxed text-muted">
          Measures the on-page quality and technical signals traditional
          search engines read. Backlinks are the one off-page factor here, and
          are always reported as unmeasured rather than estimated.
        </p>
        <dl className="space-y-3">
          {Object.entries(TRADITIONAL_WEIGHTS).map(([key, weight]) => {
            const meta = TRAD_LABELS[key as keyof typeof TRADITIONAL_WEIGHTS];
            return (
              <div key={key} className="rounded-xl border border-line bg-surface p-4">
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="font-sans text-sm font-semibold text-ink">{meta.label}</dt>
                  <dd className="font-mono text-xs text-accent">{pct(weight)}</dd>
                </div>
                <p className="mt-1.5 text-sm leading-relaxed text-muted">{meta.note}</p>
              </div>
            );
          })}
        </dl>
      </section>

      <section className="mt-10 space-y-3">
        <h2 className="font-display text-lg font-semibold text-ink">
          Page type matters
        </h2>
        <p className="text-[15px] leading-relaxed text-muted">
          Different pages have different jobs, so the same signal shouldn&apos;t
          judge them identically. We classify each page — homepage, article,
          product, category, or other — from its schema, URL, and content, and
          adapt: a homepage isn&apos;t expected to carry an author byline, a
          machine-readable update date, or cited statistics the way an article
          is, so it isn&apos;t penalized for their absence. Articles are still
          held to the full standard. The detected type is shown on every report.
        </p>
      </section>

      <section className="mt-10 space-y-3">
        <h2 className="font-display text-lg font-semibold text-ink">
          The visibility pipeline (stages + confidence)
        </h2>
        <p className="text-[15px] leading-relaxed text-muted">
          Getting cited by an AI isn&apos;t one score — it&apos;s a chain:{" "}
          <strong className="text-ink">crawlable → retrievable → citable →
          trusted → useful</strong>. 2026 research on generative visibility is
          clear that these stages are distinct and that optimizing one in
          isolation can hurt an earlier one, so alongside the two headline
          scores every report breaks the signals into those five stages. Each
          stage also carries a <strong className="text-ink">confidence</strong>{" "}
          — the share of that stage&apos;s signals we actually measured. The
          Authority &amp; Trust stage is honestly low-confidence on the free
          report, because backlinks and brand mentions are off-page signals we
          don&apos;t collect; we show that rather than renormalizing the number
          to look complete. Confidence travels with the score, never hidden
          behind it.
        </p>
      </section>

      <section className="mt-10 space-y-3">
        <h2 className="font-display text-lg font-semibold text-ink">
          Page experience (real-user field data)
        </h2>
        <p className="text-[15px] leading-relaxed text-muted">
          When available, the report also shows{" "}
          <strong className="text-ink">Core Web Vitals</strong> — LCP, INP, and
          CLS — from Google&apos;s Chrome UX Report via the PageSpeed Insights
          API. These are the only signals measured from{" "}
          <strong className="text-ink">actual visitors</strong> rather than
          inferred from the HTML, so they&apos;re shown on their own with the
          real 75th-percentile values, rated against Google&apos;s published
          thresholds — deliberately not folded into the heuristic score. Field
          data only exists for pages or sites with enough Chrome traffic, so a
          new or quiet site has none, and the panel is simply omitted rather
          than estimated.
        </p>
      </section>

      <section className="mt-10 space-y-3">
        <h2 className="font-display text-lg font-semibold text-ink">
          What this is not
        </h2>
        <ul className="list-disc space-y-2 pl-5 text-[15px] leading-relaxed text-muted">
          <li>
            <strong className="text-ink">Not calibrated against a benchmark dataset.</strong>{" "}
            These weights are reasoned from published GEO/AEO research (Princeton&apos;s
            GEO study, industry citation-rate studies), not fit to a labeled
            set of &ldquo;does an AI actually cite this page&rdquo; outcomes — no such
            dataset exists for us to calibrate against yet. Treat scores as a
            directionally-grounded checklist, not a lab-measured probability.
          </li>
          <li>
            <strong className="text-ink">Not a live cross-engine check.</strong>{" "}
            The free report never queries ChatGPT, Perplexity, Gemini, or
            Google — it scores the page itself. To see whether an AI model
            currently recommends you for a real question, use{" "}
            <Link href="/visibility" className="text-accent hover:underline">
              Keyword Visibility
            </Link>
            , which runs a live, unbiased probe (today: Claude; other
            providers activate automatically once configured).
          </li>
        </ul>
      </section>

      <section className="mt-10 space-y-3">
        <h2 className="font-display text-lg font-semibold text-ink">
          Experimental: the Claude-distilled model{" "}
          <span className="font-mono text-xs font-normal text-muted">
            {MODEL_META.version}
          </span>
        </h2>
        <p className="text-[15px] leading-relaxed text-muted">
          Alongside the two heuristic scores, fresh reports show one more number
          from a small neural network we actually trained (a 25-input → 16-unit
          → 1 model, fit by gradient descent). It is a{" "}
          <strong className="text-ink">distillation</strong>: we generated a
          corpus of page-signal profiles, had Claude judge how citable each one
          is, and trained the network to reproduce that judgment — including the
          non-linear calls a weighted checklist can&apos;t make, like
          &ldquo;great content behind an AI-blocking robots.txt is still nearly
          uncitable.&rdquo; On a held-out test split it predicts Claude&apos;s
          judgment to within a mean absolute error of {MODEL_META.testMAE} points
          (R² {MODEL_META.testR2}), versus {MODEL_META.baselineTestMAE} for
          guessing the average.
        </p>
        <p className="text-[15px] leading-relaxed text-muted">
          <strong className="text-ink">What it is not:</strong> it is trained on
          Claude&apos;s <em>opinion</em> of citability from structural signals,
          not on measured &ldquo;did an AI actually cite this page&rdquo;
          outcomes — the same missing dataset noted above. So it inherits
          Claude&apos;s reasoning, not ground truth. We show it as a labeled
          experiment, kept visually secondary to the heuristic scores, never as a
          calibrated probability. The teacher and training code are in the repo
          (<code className="font-mono text-[13px]">scripts/model</code>) so the
          distillation is fully reproducible.
        </p>
        <p className="text-[15px] leading-relaxed text-muted">
          <strong className="text-ink">Closing the gap to ground truth:</strong>{" "}
          every{" "}
          <Link href="/visibility" className="text-accent hover:underline">
            Keyword Visibility
          </Link>{" "}
          run now records a real outcome — did an AI answer engine actually
          surface the brand? Those measured outcomes accumulate as a genuine
          training set (page features → real visibility), and the pipeline can
          retrain the model on them instead of on Claude&apos;s judgment once
          enough have accrued. That&apos;s the path from &ldquo;distilled from an
          opinion&rdquo; to &ldquo;calibrated to reality&rdquo; — built, and
          waiting on data.
        </p>
      </section>
    </main>
  );
}
