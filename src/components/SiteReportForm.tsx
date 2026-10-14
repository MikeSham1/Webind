"use client";

import { useActionState, useState } from "react";
import { runSiteReport } from "@/app/site-report/actions";
import { initialSiteReportState } from "@/app/site-report/state";
import type { PageAssessment, SiteReport } from "@/lib/crawler/assess-site";
import { pageDataToCsv, type PageData } from "@/lib/crawler/extract-data";

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
          {isPending ? "Scanning…" : "Scan site"}
        </button>
      </form>

      <p className="mt-3 text-xs text-muted">
        We read the site&apos;s sitemap and score up to a dozen of its pages,
        following internal links to find more when the sitemap is short or
        missing. This runs several crawls, so it can take a little longer than
        a single report.
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
          {report.linkDiscovered > 0 &&
            `, plus ${report.linkDiscovered} found by following links`}
          {report.truncated && " (sitemap truncated to the page cap)"}.
        </p>
        {(report.blockedByRobots > 0 || report.crawlDelay !== null) && (
          <p className="mt-1 text-xs text-muted">
            We follow this site&apos;s robots.txt
            {report.blockedByRobots > 0 &&
              `: skipped ${report.blockedByRobots} page${report.blockedByRobots === 1 ? "" : "s"} it asks crawlers not to visit`}
            {report.crawlDelay !== null &&
              `${report.blockedByRobots > 0 ? ", and" : ":"} spaced requests ${report.crawlDelay}s apart as it requests`}
            .
          </p>
        )}
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

      <StructuredData report={report} />

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
                <PageRow key={p.url} page={p} />
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/** Save `content` as a file in the browser, without another server round-trip. */
function download(filename: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Which schema.org types the site publishes, and the export buttons. */
function StructuredData({ report }: { report: SiteReport }) {
  const rows = report.pages
    .map((p) => p.data)
    .filter((d): d is PageData => d !== null);
  if (rows.length === 0) return null;

  const typeCounts = new Map<string, number>();
  for (const row of rows) {
    for (const t of row.schemaTypes) typeCounts.set(t, (typeCounts.get(t) ?? 0) + 1);
  }
  const types = [...typeCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const withSchema = rows.filter((r) => r.schemaTypes.length > 0).length;
  const base = `webind-${report.origin.replace(/^https?:\/\//, "").replace(/[^a-z0-9.-]/gi, "_")}`;

  const buttonClass =
    "inline-flex h-9 items-center rounded-full border border-line-strong px-4 font-sans text-sm font-semibold text-ink transition-colors hover:border-accent hover:text-accent";

  return (
    <div>
      <h3 className="font-display text-lg font-semibold text-ink">Structured data</h3>
      <p className="mt-1 text-sm text-muted">
        {withSchema} of {rows.length} page{rows.length === 1 ? "" : "s"} publish
        schema.org data.
        {types.length === 0 && " Adding it helps search and AI engines read your pages."}
      </p>
      {types.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-2">
          {types.map(([type, count]) => (
            <li
              key={type}
              className="border border-line bg-surface px-2 py-1 font-mono text-xs text-ink"
            >
              {type} <span className="text-muted">×{count}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          className={buttonClass}
          onClick={() => download(`${base}.csv`, pageDataToCsv(rows), "text/csv;charset=utf-8")}
        >
          Download CSV
        </button>
        <button
          type="button"
          className={buttonClass}
          onClick={() =>
            download(`${base}.json`, JSON.stringify(rows, null, 2), "application/json")
          }
        >
          Download JSON
        </button>
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

/** The path+query of a URL, so the table column stays short even when a page's
 *  host differs from the origin by a `www.` prefix (discovery treats them as
 *  same-host, so both forms can appear). */
function displayPath(url: string): string {
  try {
    const u = new URL(url);
    return `${u.pathname}${u.search}` || "/";
  } catch {
    return url;
  }
}

function PageRow({ page }: { page: PageAssessment }) {
  const path = displayPath(page.url);
  return (
    <tr className="border-b border-line/60 align-top">
      <td className="max-w-[22rem] truncate py-2 pr-4 text-ink" title={page.url}>
        {path}
        {page.source === "link" && (
          <span
            className="ml-2 font-mono text-[11px] text-muted"
            title="Not in the sitemap; found by following links"
          >
            via link
          </span>
        )}
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
