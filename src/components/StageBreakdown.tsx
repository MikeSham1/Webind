import type { StageScore } from "@/lib/scoring/stages";

/**
 * The visibility pipeline as a vector, not a scalar. Each stage shows its score
 * AND its confidence together — confidence is never hidden behind the number.
 * A low-confidence stage (mostly off-page signals we can't measure on the free
 * report) is visibly muted and marked, so a high-looking score can't be read
 * without also seeing how little of it we actually measured.
 */

function gradeVar(score: number): string {
  if (score < 50) return "var(--bad)";
  if (score < 75) return "var(--warn)";
  return "var(--good)";
}

// Below this share of a stage's signal weight, we've measured too little to put
// a number on it: showing one would imply a measurement we didn't make. The
// authority stage sits here on the free report (its backlink and brand-mention
// evidence is off-page), so it reads "Insufficient data / 40% measured" rather
// than a score that looks like an independently discovered 40/100.
const MIN_SCOREABLE_CONFIDENCE = 0.6;

function StageRow({ stage }: { stage: StageScore }) {
  const pct = Math.round(stage.confidence * 100);
  const nothingMeasured = stage.score === null;
  // Enough of the stage measured to stand behind a number.
  const scoreable = !nothingMeasured && stage.confidence >= MIN_SCOREABLE_CONFIDENCE;
  const score = stage.score as number;

  return (
    <li className="py-4">
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-sans text-sm font-semibold text-ink">{stage.label}</span>
        <span className="shrink-0 font-mono text-xs text-muted">
          {scoreable ? (
            <>
              <span className="text-ink" style={{ color: gradeVar(score) }}>
                {score}
              </span>
              <span>/100</span>
            </>
          ) : (
            <span className="text-muted">
              {nothingMeasured ? "Not measured" : "Insufficient data"}
            </span>
          )}
        </span>
      </div>

      <p className="mt-1 text-xs leading-relaxed text-muted">{stage.question}</p>

      {/* Score bar only when we have the coverage to stand behind a number;
          otherwise a dashed placeholder — no fill that could read as a score. */}
      <div className="mt-2.5 h-2 w-full overflow-hidden bg-surface-2">
        {scoreable ? (
          <div
            className="h-full"
            style={{ width: `${score}%`, backgroundColor: gradeVar(score) }}
          />
        ) : (
          <div className="h-full w-full border border-dashed border-line" />
        )}
      </div>

      {/* Confidence, inseparable from the score. */}
      <div className="mt-1.5 flex items-center gap-2">
        <div className="h-1 flex-1 overflow-hidden bg-surface-2">
          <div
            className="h-full bg-accent"
            style={{ width: `${pct}%`, opacity: 0.7 }}
          />
        </div>
        <span
          className="shrink-0 font-mono text-[10px] uppercase tracking-[0.12em] text-muted"
          title="How much of this stage's signals WeBind actually measured"
        >
          {pct}% measured
        </span>
      </div>
    </li>
  );
}

export default function StageBreakdown({ stages }: { stages: StageScore[] }) {
  return (
    <section className="border border-line bg-surface p-6 sm:p-7">
      <header className="border-b-2 border-line-strong pb-4">
        <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-accent">
          The visibility pipeline
        </p>
        <p className="mt-1.5 text-sm leading-relaxed text-muted">
          Getting cited by an AI isn&apos;t one score — it&apos;s a chain:
          crawlable → retrievable → citable → trusted → useful. A weak early
          stage caps everything after it, so the vector matters more than the
          headline number. Each stage shows how much of it we could actually
          measure — where that&apos;s too little to be sure, we say so instead of
          printing a number.
        </p>
      </header>
      <ul className="divide-y divide-line">
        {stages.map((stage) => (
          <StageRow key={stage.key} stage={stage} />
        ))}
      </ul>
    </section>
  );
}
