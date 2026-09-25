import Link from "next/link";
import type { ActionableSuggestion } from "@/lib/scoring/types";

export interface FixListProps {
  /** Terse one-line fixes — the always-available baseline. */
  fixes: string[];
  /**
   * Richer, page-grounded suggestions for the top fixes. When present they
   * replace the plain list; the plain list is the fallback (e.g. saved-report
   * views, which don't regenerate suggestions).
   */
  suggestions?: ActionableSuggestion[];
  /**
   * Paywall the detailed suggestions (free/anon visitor). The ranked fixes stay
   * visible; a CTA to unlock the step-by-step version is shown below them.
   */
  locked?: boolean;
}

export default function FixList({ fixes, suggestions, locked = false }: FixListProps) {
  if (fixes.length === 0) {
    return (
      <div className="border border-good/40 bg-surface p-6 text-center sm:p-8">
        <p className="font-display text-lg font-semibold text-ink">
          No critical fixes — this page is already pulling its weight.
        </p>
        <p className="mt-2 text-sm text-muted">
          Every measured signal is scoring well. Keep publishing and keep it fresh.
        </p>
      </div>
    );
  }

  // The rich, page-grounded version is a paid feature — only render it when
  // unlocked. Otherwise the ranked fixes plus an upgrade CTA.
  if (suggestions && suggestions.length > 0 && !locked) {
    return <SuggestionList suggestions={suggestions} />;
  }

  return (
    <div className="space-y-4">
      {/* A numbered list because impact rank is real information here, not
          decoration — this is the order to actually work through the fixes in. */}
      <ol className="space-y-2.5">
        {fixes.map((fix, i) => (
          <li
            key={i}
            className="group flex items-start gap-4 border border-line bg-surface p-4 transition-colors hover:border-accent/50 sm:p-5"
          >
            <span
              className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center border border-accent/40 bg-accent-soft font-mono text-sm font-semibold text-accent"
              aria-hidden="true"
            >
              {i + 1}
            </span>
            <p className="text-sm leading-relaxed text-ink sm:text-[15px]">{fix}</p>
          </li>
        ))}
      </ol>
      {locked && <SuggestionsPaywall />}
    </div>
  );
}

/** Upsell shown in place of the detailed suggestions for free/anon visitors. */
function SuggestionsPaywall() {
  return (
    <div className="scan-frame border border-accent/50 bg-accent-soft/50 p-5 text-center sm:p-6">
      <span className="scan-corner-tr" aria-hidden="true" />
      <span className="scan-corner-bl" aria-hidden="true" />
      <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-accent">
        Starter
      </p>
      <p className="mt-2 font-display text-lg font-semibold text-ink">
        Unlock step-by-step fixes for your page
      </p>
      <p className="mx-auto mt-1.5 max-w-md text-sm leading-relaxed text-muted">
        The Fix Generator turns each fix above into concrete, copy-ready steps
        grounded in your actual page — with one-click apply. On Starter ($19/mo)
        and up.
      </p>
      <Link
        href="/pricing"
        className="mt-4 inline-flex h-10 items-center justify-center rounded-full bg-accent px-5 font-sans text-sm font-semibold text-accent-ink transition-colors hover:bg-accent-hover"
      >
        See plans →
      </Link>
    </div>
  );
}

function SuggestionList({ suggestions }: { suggestions: ActionableSuggestion[] }) {
  return (
    <ol className="space-y-4">
      {suggestions.map((s, i) => (
        <li
          key={s.key}
          className="border border-line bg-surface p-5 transition-colors hover:border-accent/50 sm:p-6"
        >
          <div className="flex items-start gap-4">
            <span
              className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center border border-accent/40 bg-accent-soft font-mono text-sm font-semibold text-accent"
              aria-hidden="true"
            >
              {i + 1}
            </span>
            <div className="min-w-0 flex-1">
              <h4 className="font-display text-base font-semibold text-ink sm:text-lg">
                {s.title}
              </h4>
              <p className="mt-1 text-sm leading-relaxed text-muted">{s.rationale}</p>

              <ul className="mt-3 space-y-1.5">
                {s.steps.map((step, j) => (
                  <li
                    key={j}
                    className="flex items-start gap-2 text-sm leading-relaxed text-ink"
                  >
                    <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-accent" aria-hidden="true" />
                    <span>{step}</span>
                  </li>
                ))}
              </ul>

              {s.example && (
                <pre className="mt-3 overflow-x-auto border border-line bg-paper p-3 font-mono text-xs leading-relaxed text-ink">
                  <code>{s.example}</code>
                </pre>
              )}
            </div>
          </div>
        </li>
      ))}
    </ol>
  );
}
