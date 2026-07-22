"use client";

import { useActionState, useState } from "react";
import { runReport, initialReportState } from "@/app/actions";
import ReportResults from "./ReportResults";

export default function ReportForm() {
  const [state, formAction, isPending] = useActionState(
    runReport,
    initialReportState,
  );
  const [url, setUrl] = useState("");

  const showError = !isPending && state.status === "error";
  const showResults = !isPending && state.status === "success";

  return (
    <div>
      <form action={formAction} className="mx-auto w-full max-w-xl">
        <label htmlFor="url" className="sr-only">
          Website address
        </label>
        <div className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-2 shadow-[0_1px_0_rgba(0,0,0,0.02)] sm:flex-row sm:items-center sm:rounded-full sm:pl-5">
          <div className="flex flex-1 items-center gap-3 px-3 sm:px-0">
            <span
              className="hidden font-mono text-sm text-muted sm:inline"
              aria-hidden="true"
            >
              https://
            </span>
            <input
              id="url"
              name="url"
              type="text"
              inputMode="url"
              autoComplete="url"
              placeholder="yourdomain.com"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              disabled={isPending}
              aria-describedby="url-hint"
              aria-invalid={showError}
              className="w-full bg-transparent py-3 font-sans text-base text-ink placeholder:text-muted/70 focus:outline-none disabled:opacity-60"
            />
          </div>
          <button
            type="submit"
            disabled={isPending}
            className="inline-flex h-12 shrink-0 items-center justify-center gap-2 rounded-full bg-accent px-6 font-sans text-[15px] font-semibold text-accent-ink transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-70"
          >
            {isPending ? (
              <>
                <Spinner />
                Analyzing…
              </>
            ) : (
              "Analyze"
            )}
          </button>
        </div>

        <p
          id="url-hint"
          className="mt-3 text-center font-mono text-xs uppercase tracking-[0.14em] text-muted"
        >
          Free · No signup · Analyzes E-E-A-T, schema, AI crawlability &amp; more
        </p>

        {showError && (
          <p
            role="alert"
            className="mx-auto mt-4 max-w-md rounded-xl border border-bad/40 bg-surface px-4 py-3 text-center text-sm text-ink"
          >
            <span className="font-semibold text-bad">Couldn&apos;t run that. </span>
            {state.error}
          </p>
        )}
      </form>

      {/* Results region */}
      <div className="mt-16" aria-live="polite">
        {isPending && <ReportSkeleton url={url} />}
        {showResults && <ReportResults report={state.report} />}
      </div>
    </div>
  );
}

function Spinner() {
  return (
    <span
      className="h-4 w-4 animate-spin rounded-full border-2 border-accent-ink/40 border-t-accent-ink"
      aria-hidden="true"
    />
  );
}

function ReportSkeleton({ url }: { url: string }) {
  return (
    <div className="mx-auto max-w-2xl text-center" aria-hidden="true">
      <div className="inline-flex items-center gap-3 rounded-full border border-line bg-surface px-5 py-2.5">
        <span className="h-2 w-2 animate-pulse rounded-full bg-accent" />
        <span className="font-mono text-xs uppercase tracking-[0.16em] text-muted">
          Crawling {url ? url : "your site"} — this takes a few seconds
        </span>
      </div>

      <div className="mt-12 flex flex-col items-center justify-center gap-12 sm:flex-row sm:gap-20">
        {[0, 1].map((i) => (
          <div key={i} className="flex flex-col items-center">
            <div
              className="h-[200px] w-[200px] rounded-full border-[16px] border-line"
              style={{ animation: "pulse-soft 1.6s ease-in-out infinite" }}
            />
            <div className="mt-5 h-5 w-32 rounded bg-line" />
          </div>
        ))}
      </div>

      <p className="mt-10 font-sans text-sm text-muted">
        Reading your content, schema, crawlability, and freshness signals…
      </p>
    </div>
  );
}
