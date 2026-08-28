"use client";

import { useActionState, useState } from "react";
import { runVisibilityCheck } from "@/app/visibility/actions";
import { initialVisibilityState } from "@/app/visibility/state";
import type {
  AnswerEngine,
  EngineVisibility,
  KeywordVisibility,
  VisibilityReport,
} from "@/lib/visibility/types";

const inputClass =
  "mt-1.5 w-full rounded-lg border border-line-strong bg-paper px-3 py-2.5 font-sans text-[15px] text-ink placeholder:text-muted/60 focus-visible:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft";

const ENGINE_LABEL: Record<AnswerEngine, string> = {
  claude: "Claude",
  openai: "ChatGPT",
  gemini: "Gemini",
  perplexity: "Perplexity",
  google: "Google",
};

function gradeVar(score: number): string {
  if (score < 50) return "var(--bad)";
  if (score < 75) return "var(--warn)";
  return "var(--good)";
}

/** Format a 0-1 rate as a whole-number percent. */
function pct(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

export default function VisibilityForm() {
  const [state, formAction, isPending] = useActionState(
    runVisibilityCheck,
    initialVisibilityState,
  );
  const [domain, setDomain] = useState("");

  const showError = !isPending && state.status === "error";
  const showResults = !isPending && state.status === "success";

  return (
    <div className="space-y-10">
      <form
        action={formAction}
        className="space-y-5 rounded-2xl border border-line bg-surface p-6 sm:p-8"
      >
        <Field label="Your website" hint="The brand you want to check for.">
          <input
            name="domain"
            required
            inputMode="url"
            placeholder="acme.com"
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            className={inputClass}
          />
        </Field>

        <Field label="Brand name" hint="Optional — defaults to the domain.">
          <input name="brandName" placeholder="Acme" className={inputClass} />
        </Field>

        <Field
          label="Keywords & questions"
          hint="One per line — the phrases people would type into an AI assistant."
        >
          <textarea
            name="keywords"
            required
            rows={5}
            placeholder={"best crm for small law firms\nwho makes durable worksite widgets\nalternatives to acme"}
            className={`${inputClass} resize-y font-mono text-sm`}
          />
        </Field>

        <button
          type="submit"
          disabled={isPending}
          className="inline-flex h-12 items-center justify-center rounded-full bg-accent px-7 font-sans text-[15px] font-semibold text-accent-ink transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-70"
        >
          {isPending ? "Checking answer engines…" : "Check visibility"}
        </button>

        {showError && (
          <p role="alert" className="text-sm text-bad">
            {state.error}
          </p>
        )}
      </form>

      {showResults && <Results report={state.report} />}
    </div>
  );
}

function Results({ report }: { report: VisibilityReport }) {
  const coveragePct = Math.round(report.coverage * 100);

  return (
    <div className="space-y-8">
      <div className="flex flex-col items-center gap-2 text-center">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted">
          AI Visibility · {report.brandName}
        </p>
        <ScoreBadge score={report.overallScore} />
        {report.enginesUsed.length > 0 ? (
          <p className="text-sm text-muted">
            Across {report.enginesUsed.map((e) => ENGINE_LABEL[e]).join(", ")}
            {coveragePct < 100 &&
              ` · scored from ${coveragePct}% of the intended checks`}
          </p>
        ) : (
          <p className="max-w-md text-sm text-muted">
            No answer engine is configured, so nothing could be measured. Set an
            engine API key to get real scores.
          </p>
        )}
        {report.visibilityRate && (
          <p
            className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted"
            title="Beta–Binomial estimate from every definite probe, with a 95% credible interval. A single probe is weak evidence, so the interval is wide until repeated probes narrow it."
          >
            Est. citation rate {pct(report.visibilityRate.rate)}
            <span className="text-muted/70">
              {" "}
              · 95% CI {pct(report.visibilityRate.lo)}–{pct(report.visibilityRate.hi)} ·{" "}
              {report.visibilityRate.hits}/{report.visibilityRate.samples} probes
            </span>
          </p>
        )}
      </div>

      <section className="space-y-3">
        <h2 className="font-display text-lg font-semibold text-ink">
          Per keyword
        </h2>
        <ul className="space-y-3">
          {report.keywords.map((k) => (
            <KeywordRow key={k.keyword} keyword={k} />
          ))}
        </ul>
      </section>

      {report.topCompetitors.length > 0 && (
        <section className="space-y-2">
          <h2 className="font-display text-lg font-semibold text-ink">
            Who gets recommended instead
          </h2>
          <div className="flex flex-wrap gap-2">
            {report.topCompetitors.slice(0, 12).map((c) => (
              <span
                key={c}
                className="rounded-full border border-line px-3 py-1 font-mono text-xs text-muted"
              >
                {c}
              </span>
            ))}
          </div>
        </section>
      )}

      <section className="space-y-2">
        <h2 className="font-display text-lg font-semibold text-ink">
          Highest-impact fixes
        </h2>
        <ol className="space-y-2">
          {report.recommendations.map((rec, i) => (
            <li
              key={i}
              className="rounded-xl border border-line bg-surface p-4 text-sm leading-relaxed text-ink"
            >
              {rec}
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

function ScoreBadge({ score }: { score: number | null }) {
  if (score === null) {
    return (
      <span className="font-display text-5xl font-semibold text-muted">n/a</span>
    );
  }
  return (
    <span
      className="font-display text-5xl font-semibold"
      style={{ color: gradeVar(score) }}
    >
      {score}
      <span className="text-2xl text-muted">/100</span>
    </span>
  );
}

function KeywordRow({ keyword }: { keyword: KeywordVisibility }) {
  return (
    <li className="rounded-xl border border-line bg-surface p-4">
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-sans text-sm font-semibold text-ink">
          {keyword.keyword}
        </span>
        <span className="shrink-0 font-mono text-xs">
          {keyword.score === null ? (
            <span className="text-muted">not measured</span>
          ) : (
            <span style={{ color: gradeVar(keyword.score) }}>
              {keyword.score}/100
            </span>
          )}
        </span>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {keyword.engines.map((e) => (
          <EngineChip key={e.engine} engine={e} />
        ))}
      </div>
    </li>
  );
}

function EngineChip({ engine }: { engine: EngineVisibility }) {
  const { label, tone } = chipState(engine);
  const toneClass =
    tone === "good"
      ? "border-good/40 text-good"
      : tone === "bad"
        ? "border-bad/40 text-bad"
        : "border-line text-muted";
  return (
    <span
      className={`rounded-full border px-2.5 py-1 font-mono text-[11px] ${toneClass}`}
      title={engine.evidence ?? undefined}
    >
      {ENGINE_LABEL[engine.engine]}: {label}
    </span>
  );
}

function chipState(e: EngineVisibility): {
  label: string;
  tone: "good" | "bad" | "muted";
} {
  if (!e.configured) return { label: "not set", tone: "muted" };
  if (e.present === null) return { label: "unknown", tone: "muted" };
  if (e.present) {
    const p = e.prominence;
    return { label: p !== null ? `visible ${p}` : "visible", tone: "good" };
  }
  return { label: "absent", tone: "bad" };
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="font-sans text-sm font-medium text-ink">{label}</span>
      {hint && <span className="ml-2 text-xs text-muted">{hint}</span>}
      {children}
    </label>
  );
}
