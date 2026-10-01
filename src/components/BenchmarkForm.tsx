"use client";

import { useActionState, useState, type ReactNode } from "react";
import { runBenchmarkAction } from "@/app/benchmark/actions";
import { initialBenchmarkState } from "@/app/benchmark/state";
import type { BenchmarkReport, CompetitorScore, Percentile } from "@/lib/benchmark/types";
import { parseDomainInput } from "@/lib/domainInput";

const inputClass =
  "mt-1.5 w-full rounded-lg border border-line-strong bg-paper px-3 py-2.5 font-sans text-[15px] text-ink placeholder:text-muted/60 focus-visible:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft";

function gradeVar(score: number): string {
  if (score < 50) return "var(--bad)";
  if (score < 75) return "var(--warn)";
  return "var(--good)";
}

/** 82 → "82nd". Percentiles read naturally as ordinals. */
function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]);
}

export default function BenchmarkForm() {
  const [state, formAction, isPending] = useActionState(
    runBenchmarkAction,
    initialBenchmarkState,
  );
  const [url, setUrl] = useState("");
  const [clientError, setClientError] = useState<string | null>(null);

  const errorMessage =
    clientError ?? (!isPending && state.status === "error" ? state.error : null);
  const showError = Boolean(errorMessage);
  const showResults = !isPending && state.status === "success";

  return (
    <div className="space-y-10">
      <form
        action={formAction}
        onSubmit={(e) => {
          const validation = parseDomainInput(url);
          if (!validation.ok) {
            e.preventDefault();
            setClientError(validation.error);
          }
        }}
        className="space-y-5 rounded-2xl border border-line bg-surface p-6 sm:p-8"
      >
        <Field label="Your site" hint="Enter the domain without https:// or a path.">
          <div className="mt-1.5 flex items-center gap-2 rounded-lg border border-line-strong bg-paper px-3 focus-within:border-accent focus-within:ring-2 focus-within:ring-accent-soft">
            <span className="font-mono text-sm text-muted" aria-hidden="true">
              https://
            </span>
            <input
              name="url"
              required
              inputMode="url"
              placeholder="acme.com"
              value={url}
              onChange={(e) => {
                setUrl(e.target.value);
                if (clientError) setClientError(null);
              }}
              className="w-full bg-transparent py-2.5 font-sans text-[15px] text-ink placeholder:text-muted/60 focus:outline-none"
            />
          </div>
        </Field>

        <Field
          label="Target query"
          hint="The search you want to win — we rank you against the pages that already do."
        >
          <input
            name="query"
            required
            placeholder="best crm for small law firms"
            className={inputClass}
          />
        </Field>

        <button
          type="submit"
          disabled={isPending}
          className="inline-flex h-12 items-center justify-center rounded-full bg-accent px-7 font-sans text-[15px] font-semibold text-accent-ink transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-70"
        >
          {isPending ? "Crawling the field…" : "Benchmark against the field"}
        </button>

        {showError && (
          <p role="alert" className="text-sm text-bad">
            {errorMessage}
          </p>
        )}
      </form>

      {showResults && <Results report={state.report} />}
    </div>
  );
}

function Results({ report }: { report: BenchmarkReport }) {
  if (!report.configured) {
    return (
      <div className="rounded-2xl border border-dashed border-line bg-surface p-6 text-center">
        <p className="font-mono text-xs uppercase tracking-[0.18em] text-accent">
          Not configured
        </p>
        <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted">{report.note}</p>
      </div>
    );
  }

  const scored = report.competitors.filter((c) => c.ok);

  return (
    <div className="space-y-8">
      <div className="flex flex-col items-center gap-2 text-center">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted">
          {report.target.domain} · &ldquo;{report.query}&rdquo;
        </p>
        <PercentileBadge label="AI readiness" percentile={report.aiPercentile} score={report.target.ai} />
        <p className="text-sm text-muted">{report.note}</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <PercentileCard label="AI readiness" percentile={report.aiPercentile} score={report.target.ai} />
        <PercentileCard
          label="Traditional authority"
          percentile={report.traditionalPercentile}
          score={report.target.traditional}
        />
      </div>

      <section className="space-y-3">
        <h2 className="font-display text-lg font-semibold text-ink">The field</h2>
        <ul className="space-y-2">
          {report.competitors.map((c) => (
            <CompetitorRow key={c.url} c={c} />
          ))}
        </ul>
        {scored.length === 0 && (
          <p className="text-sm text-muted">
            None of the competitor pages could be crawled, so no percentile could be computed.
          </p>
        )}
      </section>
    </div>
  );
}

function PercentileBadge({
  percentile,
}: {
  label: string;
  percentile: Percentile | null;
  score: number | null;
}) {
  if (!percentile) {
    return <span className="font-display text-5xl font-semibold text-muted">n/a</span>;
  }
  return (
    <span className="font-display text-5xl font-semibold" style={{ color: gradeVar(percentile.value) }}>
      {ordinal(percentile.value)}
      <span className="text-2xl text-muted"> pctl</span>
    </span>
  );
}

function PercentileCard({
  label,
  percentile,
  score,
}: {
  label: string;
  percentile: Percentile | null;
  score: number | null;
}) {
  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted">{label}</p>
      <div className="mt-1.5 flex items-baseline gap-2">
        {percentile ? (
          <>
            <span
              className="font-display text-2xl font-semibold"
              style={{ color: gradeVar(percentile.value) }}
            >
              {ordinal(percentile.value)}
            </span>
            <span className="font-mono text-[11px] text-muted">
              95% CI {ordinal(percentile.lo)}–{ordinal(percentile.hi)} · vs {percentile.n} rivals
            </span>
          </>
        ) : (
          <span className="font-display text-2xl font-semibold text-muted">n/a</span>
        )}
      </div>
      <p className="mt-1 font-mono text-[11px] text-muted">
        Your score {score ?? "—"}/100
      </p>
    </div>
  );
}

function CompetitorRow({ c }: { c: CompetitorScore }) {
  return (
    <li className="flex items-center justify-between gap-3 rounded-lg border border-line bg-surface px-4 py-2.5">
      <div className="flex min-w-0 items-center gap-2.5">
        <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.12em] text-muted">
          #{c.position} · {c.cohort}
        </span>
        <span className="truncate font-sans text-sm text-ink">{c.domain}</span>
      </div>
      <span className="shrink-0 font-mono text-xs">
        {c.ai === null ? (
          <span className="text-muted" title={c.error}>
            couldn&apos;t crawl
          </span>
        ) : (
          <span style={{ color: gradeVar(c.ai) }}>{c.ai}/100</span>
        )}
      </span>
    </li>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="font-sans text-sm font-semibold text-ink">{label}</span>
      {hint && <span className="ml-2 font-sans text-xs text-muted">{hint}</span>}
      {children}
    </label>
  );
}
