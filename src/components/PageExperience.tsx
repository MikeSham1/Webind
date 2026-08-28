import type { FieldVitals, Vital, VitalRating } from "@/lib/vitals/types";

/**
 * Core Web Vitals field panel. These are the report's only signals measured
 * from real visitors (Chrome UX Report via PageSpeed Insights), so they're
 * shown on their own, with the underlying p75 values exposed and each metric
 * rated against Google's thresholds — never rolled into the heuristic score.
 */

const RATING_VAR: Record<VitalRating, string> = {
  good: "var(--good)",
  "needs-improvement": "var(--warn)",
  poor: "var(--bad)",
};

const RATING_LABEL: Record<VitalRating, string> = {
  good: "Good",
  "needs-improvement": "Needs work",
  poor: "Poor",
};

const METRIC_LABEL: Record<Vital["metric"], string> = {
  LCP: "Largest Contentful Paint",
  INP: "Interaction to Next Paint",
  CLS: "Cumulative Layout Shift",
};

/** Human-readable p75 value in the metric's natural unit. */
function formatValue(v: Vital): string {
  if (v.metric === "CLS") return v.value.toFixed(2);
  if (v.metric === "LCP") return `${(v.value / 1000).toFixed(1)} s`;
  return `${Math.round(v.value)} ms`; // INP
}

export default function PageExperience({ vitals }: { vitals: FieldVitals }) {
  return (
    <section className="border border-line bg-surface p-6 sm:p-7">
      <header className="flex items-baseline justify-between gap-3 border-b-2 border-line-strong pb-4">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-accent">
            <span aria-hidden="true">[ </span>
            Page experience · real users
            <span aria-hidden="true"> ]</span>
          </p>
          <p className="mt-1.5 text-sm leading-relaxed text-muted">
            Core Web Vitals from the Chrome UX Report — measured from actual
            visitors over the last 28 days, at the 75th percentile.
            {vitals.source === "origin" &&
              " This page has little traffic, so these are whole-site figures."}
          </p>
        </div>
        <span
          className="shrink-0 rounded-full px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.14em]"
          style={{ color: RATING_VAR[vitals.overall], border: `1px solid ${RATING_VAR[vitals.overall]}` }}
        >
          {RATING_LABEL[vitals.overall]}
        </span>
      </header>

      <dl className="mt-4 grid gap-4 sm:grid-cols-3">
        {vitals.metrics.map((v) => (
          <div key={v.metric}>
            <dt className="flex items-baseline justify-between gap-2">
              <span className="font-mono text-xs font-semibold text-ink">{v.metric}</span>
              <span
                className="font-display text-xl font-semibold tabular-nums"
                style={{ color: RATING_VAR[v.rating] }}
              >
                {formatValue(v)}
              </span>
            </dt>
            <dd className="mt-0.5 text-xs leading-relaxed text-muted">{METRIC_LABEL[v.metric]}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
