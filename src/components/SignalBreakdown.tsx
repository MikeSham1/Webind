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
  const coveragePct = Math.round(score.coverage * 100);
  // The single ceiling that actually bound the total (the lowest one).
  const activeCap =
    score.caps.length > 0
      ? score.caps.reduce((lo, c) => (c.ceiling < lo.ceiling ? c : lo))
      : null;

  return (
    <section className="border border-line bg-surface p-6 sm:p-7">
      <header className="flex items-baseline justify-between gap-4 border-b-2 border-line-strong pb-4">
        <h3 className="font-display text-lg font-semibold text-ink">{title}</h3>
        <span className="font-mono text-sm text-muted">
          <span className="text-ink">{score.total}</span>
          <span className="text-muted">/100</span>
        </span>
      </header>

      {activeCap && (
        // A failed fundamental is capping the score — say so, and why, rather
        // than leaving the visitor to wonder why strong signals scored low.
        <div className="mt-3 border-l-2 border-bad bg-bad/5 py-2 pl-3">
          <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-bad">
            Capped at {activeCap.ceiling}/100
          </p>
          <p className="mt-1 text-xs leading-relaxed text-ink">
            A fundamental is failing: {activeCap.label.toLowerCase()}.{" "}
            {activeCap.fix}
            {score.caps.length > 1 && (
              <span className="text-muted">
                {" "}
                ({score.caps.length - 1} other fundamental
                {score.caps.length - 1 > 1 ? "s" : ""} also failing.)
              </span>
            )}
          </p>
        </div>
      )}

      {coveragePct < 100 && (
        // Say plainly how much of the model ran, rather than letting a score
        // built from part of the signals look like a score built from all.
        <p className="mt-3 text-xs leading-relaxed text-muted">
          Scored from {coveragePct}% of this model&apos;s signals — the rest need
          off-page data we don&apos;t collect yet, and are excluded rather than
          guessed.
        </p>
      )}

      <ul className="mt-2 divide-y divide-line">
        {score.signals.map((signal) => {
          const weightPct = Math.round(signal.weight * 100);
          const measured = signal.score !== null;
          return (
            <li key={signal.key} className={measured ? "py-4" : "py-4 opacity-60"}>
              <div className="flex items-baseline justify-between gap-3">
                <span className="font-sans text-sm font-semibold text-ink">
                  {signal.label}
                </span>
                <span className="shrink-0 font-mono text-xs text-muted">
                  <span className="text-ink">
                    {measured ? signal.score : "n/a"}
                  </span>
                  <span aria-hidden="true"> · </span>
                  <span title="Share of this authority score">{weightPct}% weight</span>
                </span>
              </div>

              {measured ? (
                <div
                  className="mt-2.5 h-1.5 w-full overflow-hidden bg-surface-2"
                  role="meter"
                  aria-valuenow={signal.score as number}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label={`${signal.label} score`}
                >
                  <div
                    className="bar-grow h-full"
                    style={{
                      width: `${signal.score}%`,
                      backgroundColor: gradeVar(signal.score as number),
                    }}
                  />
                </div>
              ) : (
                <div
                  className="mt-2.5 h-1.5 w-full border border-dashed border-line"
                  aria-label={`${signal.label} not measured`}
                />
              )}

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
