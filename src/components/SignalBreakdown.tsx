import type { AuthorityScore } from "@/lib/scoring/types";

export interface SignalBreakdownProps {
  title: string;
  score: AuthorityScore;
}

function gradeVar(score: number): string {
  if (score < 50) return "var(--bad)";
  if (score < 75) return "var(--warn)";
  return "var(--good)";
}

export default function SignalBreakdown({ title, score }: SignalBreakdownProps) {
  return (
    <section className="rounded-2xl border border-line bg-surface p-6 sm:p-7">
      <header className="flex items-baseline justify-between gap-4 border-b border-line pb-4">
        <h3 className="font-display text-lg font-semibold text-ink">{title}</h3>
        <span className="font-mono text-sm text-muted">
          <span className="text-ink">{score.total}</span>
          <span className="text-muted">/100</span>
        </span>
      </header>

      <ul className="mt-2 divide-y divide-line">
        {score.signals.map((signal) => {
          const color = gradeVar(signal.score);
          const weightPct = Math.round(signal.weight * 100);
          return (
            <li key={signal.key} className="py-4">
              <div className="flex items-baseline justify-between gap-3">
                <span className="font-sans text-sm font-semibold text-ink">
                  {signal.label}
                </span>
                <span className="shrink-0 font-mono text-xs text-muted">
                  <span className="text-ink">{signal.score}</span>
                  <span aria-hidden="true"> · </span>
                  <span title="Share of this authority score">{weightPct}% weight</span>
                </span>
              </div>

              <div
                className="mt-2.5 h-2 w-full overflow-hidden rounded-full bg-surface-2"
                role="meter"
                aria-valuenow={signal.score}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={`${signal.label} score`}
              >
                <div
                  className="bar-grow h-full rounded-full"
                  style={{ width: `${signal.score}%`, backgroundColor: color }}
                />
              </div>

              <p className="mt-2 text-sm leading-relaxed text-muted">
                {signal.reason}
              </p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
