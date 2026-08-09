import type { Metadata } from "next";
import Link from "next/link";
import { AI_WEIGHTS, TRADITIONAL_WEIGHTS, SCORING_MODEL_VERSION } from "@/lib/scoring/weights";

export const metadata: Metadata = {
  title: "Methodology — WeBind",
  description: "How WeBind's AI Readiness and Traditional Authority scores are built, and what they don't yet measure.",
  // Pre-launch: keep the whole site out of search indexes (see root layout).
  robots: { index: false, follow: false, nocache: true },
};

const AI_LABELS: Record<keyof typeof AI_WEIGHTS, { label: string; note: string }> = {
  eeat: {
    label: "E-E-A-T Signals",
    note: "Author bylines, about/contact pages, and other trust markers — 2026 research found 96% of AI-Overview citations carry strong E-E-A-T, and unauthored pages are cited ~40% less.",
  },
  answerability: {
    label: "Answer-ready Structure",
    note: "Lists, FAQs, and content near the top of the page — lists correlate with +30% citation odds for Claude, FAQ blocks +28-40%, and 44% of citations come from the first 30% of a page.",
  },
  factDensity: {
    label: "Fact Density & Evidence",
    note: "Concrete numbers, statistics, and cited data. Princeton's GEO study found this the single strongest lever they tested, at +41%.",
  },
  schema: {
    label: "Schema Markup",
    note: "Structured data (JSON-LD) that lets a model parse what a page is about without inferring it from prose.",
  },
  aiCrawlability: {
    label: "AI Crawlability",
    note: "Whether robots.txt welcomes named AI crawlers (GPTBot, ClaudeBot, PerplexityBot, Google-Extended) and whether an llms.txt exists.",
  },
  freshness: {
    label: "Content Freshness",
    note: "A recoverable last-modified date, and how recent it is.",
  },
  brandMentions: {
    label: "Brand Mentions (off-page)",
    note: "Whether the brand is actually surfaced when an AI model is asked about the topic — measured only by the separate, live Keyword Visibility check, not the free report.",
  },
};

const TRAD_LABELS: Record<keyof typeof TRADITIONAL_WEIGHTS, { label: string; note: string }> = {
  contentQuality: {
    label: "Content Quality",
    note: "Word count, heading structure, and readability.",
  },
  technicalSeo: {
    label: "Technical SEO",
    note: "Canonical tags, viewport meta, HTML lang, and other on-page technical hygiene.",
  },
  topicalAuthority: {
    label: "Topical Authority",
    note: "Internal linking and topical depth on the page itself.",
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
        ← WeBind
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
          What this is not
        </h2>
        <ul className="list-disc space-y-2 pl-5 text-[15px] leading-relaxed text-muted">
          <li>
            <strong className="text-ink">Not calibrated against a benchmark dataset.</strong>{" "}
            These weights are reasoned from published GEO/AEO research (Princeton&apos;s
            GEO study, industry citation-rate studies), not fit to a labeled
            set of "does an AI actually cite this page" outcomes — no such
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
    </main>
  );
}
