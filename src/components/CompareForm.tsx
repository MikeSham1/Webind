"use client";

import { useActionState, useState } from "react";
import { runCompareAction } from "@/app/compare/actions";
import { initialCompareState } from "@/app/compare/compare-state";
import type { CompareSide } from "@/app/compare/compare-state";
import { parseDomainInput } from "@/lib/domainInput";
import ScoreDial from "./ScoreDial";

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function Delta({ a, b }: { a: number; b: number }) {
  const diff = a - b;
  if (diff === 0) return <span className="text-muted">Tied</span>;
  const ahead = diff > 0;
  return (
    <span className={ahead ? "text-good" : "text-muted"}>
      {ahead ? "▲" : "▼"} {Math.abs(diff)} {ahead ? "ahead" : "behind"}
    </span>
  );
}

function SideColumn({
  side,
  otherAi,
  otherTraditional,
}: {
  side: CompareSide;
  otherAi: number | null;
  otherTraditional: number | null;
}) {
  if (side.status === "error") {
    return (
      <div className="flex flex-1 flex-col items-center justify-center border border-bad/40 bg-surface p-8 text-center">
        <p className="font-mono text-xs uppercase tracking-[0.16em] text-bad">
          Couldn&apos;t read this one
        </p>
        <p className="mt-2 text-sm text-muted">{side.error}</p>
      </div>
    );
  }

  const { report } = side;
  return (
    <div className="scan-frame flex flex-1 flex-col items-center border border-line bg-surface p-6 sm:p-8">
      <h3 className="font-display text-lg font-semibold text-ink">{hostOf(report.url)}</h3>
      <div className="mt-6 flex flex-col items-center gap-8">
        <div>
          <ScoreDial label="AI Readiness" score={report.ai.total} />
          {otherAi !== null && (
            <p className="mt-2 text-center font-mono text-xs uppercase tracking-[0.1em]">
              <Delta a={report.ai.total} b={otherAi} />
            </p>
          )}
        </div>
        <div>
          <ScoreDial label="Traditional Authority" score={report.traditional.total} />
          {otherTraditional !== null && (
            <p className="mt-2 text-center font-mono text-xs uppercase tracking-[0.1em]">
              <Delta a={report.traditional.total} b={otherTraditional} />
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

export default function CompareForm() {
  const [state, formAction, isPending] = useActionState(
    runCompareAction,
    initialCompareState,
  );
  const [urlA, setUrlA] = useState("");
  const [urlB, setUrlB] = useState("");
  const [clientError, setClientError] = useState<string | null>(null);

  const errorMessage =
    clientError ?? (!isPending && state.status === "error" ? state.error : null);
  const showError = Boolean(errorMessage);
  const showResults = !isPending && state.status === "success";

  return (
    <div>
      <p className="sr-only" role="status" aria-live="polite">
        {isPending
          ? "Comparing both sites…"
          : state.status === "success"
            ? "Comparison ready."
            : errorMessage ?? ""}
      </p>

      <form
        action={formAction}
        onSubmit={(e) => {
          const a = parseDomainInput(urlA);
          const b = parseDomainInput(urlB);
          if (!a.ok) {
            e.preventDefault();
            setClientError(`Your site: ${a.error}`);
          } else if (!b.ok) {
            e.preventDefault();
            setClientError(`Competitor: ${b.error}`);
          }
        }}
        className="mx-auto w-full max-w-3xl"
      >
        <div className="grid gap-4 sm:grid-cols-2">
          {[
            { name: "urlA", value: urlA, set: setUrlA, label: "Your site" },
            { name: "urlB", value: urlB, set: setUrlB, label: "Competitor" },
          ].map((f) => (
            <div key={f.name}>
              <label htmlFor={f.name} className="sr-only">
                {f.label} website domain
              </label>
              <p className="mb-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-muted">
                {f.label}
              </p>
              <div className="scan-frame flex items-center gap-2 border border-line bg-surface px-4 py-3 focus-within:border-accent focus-within:ring-2 focus-within:ring-accent-soft">
                <span className="hidden font-mono text-sm text-muted sm:inline" aria-hidden="true">
                  https://
                </span>
                <input
                  id={f.name}
                  name={f.name}
                  type="text"
                  inputMode="url"
                  autoComplete="url"
                  placeholder="yourdomain.com"
                  value={f.value}
                  onChange={(e) => {
                    f.set(e.target.value);
                    if (clientError) setClientError(null);
                  }}
                  disabled={isPending}
                  className="w-full bg-transparent font-sans text-base text-ink placeholder:text-muted/70 focus:outline-none disabled:opacity-60"
                />
              </div>
            </div>
          ))}
        </div>

        <div className="mt-5 text-center">
          <button
            type="submit"
            disabled={isPending}
            className="inline-flex h-12 items-center justify-center gap-2 rounded-full bg-accent px-8 font-sans text-[15px] font-semibold text-accent-ink transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-70"
          >
            {isPending ? "Reading both sites…" : "Compare"}
          </button>
        </div>

        {showError && (
          <p
            role="alert"
            className="mx-auto mt-4 max-w-md border border-bad/40 bg-surface px-4 py-3 text-center text-sm text-ink"
          >
            <span className="font-semibold text-bad">Couldn&apos;t run that. </span>
            {errorMessage}
          </p>
        )}
      </form>

      <div className="mt-14">
        {showResults && (
          <div className="reveal flex flex-col items-stretch gap-6 sm:flex-row">
            <SideColumn
              side={state.a}
              otherAi={state.b.status === "ok" ? state.b.report.ai.total : null}
              otherTraditional={
                state.b.status === "ok" ? state.b.report.traditional.total : null
              }
            />
            <SideColumn
              side={state.b}
              otherAi={state.a.status === "ok" ? state.a.report.ai.total : null}
              otherTraditional={
                state.a.status === "ok" ? state.a.report.traditional.total : null
              }
            />
          </div>
        )}
      </div>
    </div>
  );
}
