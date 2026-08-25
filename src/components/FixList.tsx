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
}

export default function FixList({ fixes, suggestions }: FixListProps) {
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

  if (suggestions && suggestions.length > 0) {
    return <SuggestionList suggestions={suggestions} />;
  }

  return (
    // A numbered list because impact rank is real information here, not
    // decoration — this is the order to actually work through the fixes in.
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
