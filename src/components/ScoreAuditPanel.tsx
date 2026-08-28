import type { ScoreAudit, ScoreFlag } from "@/lib/scoring/audit";

/**
 * Admin-only "score audit": an LLM second opinion on our own scores, flagging
 * any that look wrong for this page. A review aid to catch scoring bugs — never
 * a score change. Shown only to admins (see the report action).
 */

const VERDICT_LABEL: Record<ScoreFlag["verdict"], string> = {
  too_high: "Too high",
  too_low: "Too low",
  plausible: "Plausible",
};

const SEVERITY_VAR: Record<ScoreFlag["severity"], string> = {
  high: "var(--bad)",
  medium: "var(--warn)",
  low: "var(--muted)",
};

export default function ScoreAuditPanel({ audit }: { audit: ScoreAudit }) {
  return (
    <section className="border border-dashed border-line-strong bg-surface p-6 sm:p-7">
      <header className="flex items-baseline justify-between gap-3 border-b border-line pb-3">
        <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-accent">
          <span aria-hidden="true">[ </span>
          AI score review · admin
          <span aria-hidden="true"> ]</span>
        </p>
        <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted">Gemini</span>
      </header>

      <p className="mt-3 text-sm leading-relaxed text-muted">{audit.note}</p>

      {audit.flags.length > 0 && (
        <ul className="mt-4 space-y-2.5">
          {audit.flags.map((f, i) => (
            <li key={`${f.signalKey}-${i}`} className="rounded-xl border border-line bg-paper p-3">
              <div className="flex items-baseline justify-between gap-3">
                <span className="font-mono text-xs font-semibold text-ink">{f.signalKey}</span>
                <span
                  className="font-mono text-[10px] uppercase tracking-[0.12em]"
                  style={{ color: SEVERITY_VAR[f.severity] }}
                >
                  {VERDICT_LABEL[f.verdict]} · {f.severity}
                </span>
              </div>
              <p className="mt-1 text-sm leading-relaxed text-muted">{f.explanation}</p>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-4 font-mono text-[10px] uppercase tracking-[0.12em] text-muted">
        A review aid — flags never change a score.
      </p>
    </section>
  );
}
