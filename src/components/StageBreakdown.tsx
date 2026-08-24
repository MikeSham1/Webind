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

const LOW_CONFIDENCE = 0.6;

function StageRow({ stage }: { stage: StageScore }) {
  const pct = Math.round(stage.confidence * 100);
  const measured = stage.score !== null;
  const lowConf = stage.confidence < LOW_CONFIDENCE;

  return (
    <li className="py-4">
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-sans text-sm font-semibold text-ink">{stage.label}</span>
        <span className="shrink-0 font-mono text-xs text-muted">
          {measured ? (
            <>
              <span className="text-ink" style={{ color: gradeVar(stage.score as number) }}>
                {lowConf ? "~" : ""}
                {stage.score}
              </span>
              <span>/100</span>
            </>
          ) : (
            <span className="text-muted">not measured</span>
          )}
        </span>
      </div>

      <p className="mt-1 text-xs leading-relaxed text-muted">{stage.question}</p>

      {/* Score bar. Low-confidence stages are hatched so the fill visibly reads
          as "estimated from partial data", not a solid measurement. */}
      <div className="mt-2.5 h-2 w-full overflow-hidden bg-surface-2">
        {measured ? (
          <div
            className="h-full"
            style={{
              width: `${stage.score}%`,
              backgroundColor: gradeVar(stage.score as number),
              opacity: lowConf ? 0.55 : 1,
              backgroundImage: lowConf
                ? "repeating-linear-gradient(45deg, transparent 0 4px, rgba(0,0,0,0.18) 4px 8px)"
                : undefined,
            }}
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
          <span aria-hidden="true">[ </span>
          The visibility pipeline
          <span aria-hidden="true"> ]</span>
        </p>
        <p className="mt-1.5 text-sm leading-relaxed text-muted">
          Getting cited by an AI isn&apos;t one score — it&apos;s a chain:
          crawlable → retrievable → citable → trusted → useful. A weak early
          stage caps everything after it, so the vector matters more than the
          headline number. Each stage shows how much of it we could actually
          measure.
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
