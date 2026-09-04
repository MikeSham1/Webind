"use client";

import { useActionState, useState } from "react";
import { runSiteReport } from "@/app/site-report/actions";
import { initialSiteReportState } from "@/app/site-report/state";
import type { PageAssessment, SiteReport } from "@/lib/crawler/assess-site";

const inputClass =
  "w-full rounded-lg border border-line-strong bg-paper px-4 py-3 font-sans text-[15px] text-ink placeholder:text-muted/60 focus-visible:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft";

export default function SiteReportForm() {
  const [state, formAction, isPending] = useActionState(
    runSiteReport,
    initialSiteReportState,
  );
  const [site, setSite] = useState("");

  const showError = !isPending && state.status === "error";
  const showResults = !isPending && state.status === "success";

  return (
    <div>
      <p className="sr-only" role="status" aria-live="polite">
        {isPending
          ? `Scanning ${site.trim() || "the site"}…`
          : state.status === "success"
            ? "Site scan ready."
            : state.status === "error"
              ? state.error
              : ""}
      </p>

      <form action={formAction} className="flex flex-col gap-3 sm:flex-row">
        <label htmlFor="site" className="sr-only">
          Website domain
        </label>
        <input
          id="site"
          name="site"
          type="text"
          inputMode="url"
          placeholder="yourdomain.com"
          value={site}
          onChange={(e) => setSite(e.target.value)}
          disabled={isPending}
          className={inputClass}
        />
        <button
          type="submit"
          disabled={isPending}
          className="inline-flex h-12 shrink-0 items-center justify-center rounded-full bg-accent px-7 font-sans text-[15px] font-semibold text-accent-ink transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-70"
        >
          {isPending ? "Scanning…" : "Scan sitemap"}
        </button>
      </form>

      <p className="mt-3 text-xs text-muted">
        We read the site&apos;s sitemap and score up to a dozen of its pages.
        This runs several crawls, so it can take a little longer than a single
        report.
      </p>

      {showError && (
        <p role="alert" className="mt-4 text-sm text-bad">
          {state.error}
        </p>
      )}

      {showResults && <SiteResults report={state.report} />}
    </div>
  );
}

function scoreColor(score: number | null): string {
  if (score === null) return "text-muted";
  if (score < 50) return "text-bad";
  if (score < 75) return "text-warn";
  return "text-good";
}

function SiteResults({ report }: { report: SiteReport }) {
  const host = report.origin.replace(/^https?:\/\//, "");
  const scored = report.pages.filter((p) => p.ok).length;

  return (
    <div className="mt-10 space-y-8">
      <div>
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted">
          Site scan · {host}
        </p>
        <p className="mt-2 text-[15px] text-ink">
          Assessed <strong>{scored}</strong> of {report.pages.length} page
          {report.pages.length === 1 ? "" : "s"} from{" "}
          {report.sitemaps.length > 0
            ? `${report.sitemaps.length} sitemap${report.sitemaps.length === 1 ? "" : "s"}`
            : "the entered URL"}
          {report.truncated && " (sitemap truncated to the page cap)"}.
        </p>
      </div>

      {/* Site averages */}
      <div className="flex gap-10">
        <Average label="Avg. AI Readiness" value={report.averageAi} />
        <Average label="Avg. Traditional" value={report.averageTraditional} />
      </div>

      {/* Common fixes across the site */}
      {report.commonFixes.length > 0 && (
        <div>
          <h3 className="font-display text-lg font-semibold text-ink">
            Fixes that recur across the site
          </h3>
          <ul className="mt-3 space-y-2">
            {report.commonFixes.map((f) => (
              <li
                key={f.fix}
                className="flex items-start gap-3 border border-line bg-surface p-3 text-sm text-ink"
              >
                <span className="shrink-0 font-mono text-xs text-accent">
                  ×{f.count}
                </span>
                <span>{f.fix}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Per-page table */}
      <div>
        <h3 className="font-display text-lg font-semibold text-ink">
          Every page
        </h3>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-line text-left font-mono text-[11px] uppercase tracking-[0.14em] text-muted">
                <th className="py-2 pr-4">Page</th>
                <th className="py-2 pr-4 text-right">AI</th>
                <th className="py-2 text-right">Trad.</th>
              </tr>
            </thead>
            <tbody>
              {report.pages.map((p) => (
                <PageRow key={p.url} page={p} origin={report.origin} />
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Average({ label, value }: { label: string; value: number | null }) {
  return (
    <div>
      <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted">
        {label}
      </p>
      <p className={`mt-1 font-display text-4xl font-semibold ${scoreColor(value)}`}>
        {value ?? "—"}
        {value !== null && <span className="text-base text-muted">/100</span>}
      </p>
    </div>
  );
}

function PageRow({ page, origin }: { page: PageAssessment; origin: string }) {
  const path = page.url.startsWith(origin) ? page.url.slice(origin.length) || "/" : page.url;
  return (
    <tr className="border-b border-line/60 align-top">
      <td className="max-w-[22rem] truncate py-2 pr-4 text-ink" title={page.url}>
        {path}
        {!page.ok && (
          <span className="ml-2 font-mono text-[11px] text-bad">
            failed: {page.error}
          </span>
        )}
      </td>
      <td className={`py-2 pr-4 text-right font-mono ${scoreColor(page.ai)}`}>
        {page.ai ?? "—"}
      </td>
      <td className={`py-2 text-right font-mono ${scoreColor(page.traditional)}`}>
        {page.traditional ?? "—"}
      </td>
    </tr>
  );
}
