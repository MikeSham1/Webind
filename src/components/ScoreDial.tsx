"use client";

import { useEffect, useState } from "react";

export interface ScoreDialProps {
  label: string;
  score: number;
  /** Small line under the label, e.g. how the score is composed. */
  sublabel?: string;
  /** Staggered entrance delay in ms. */
  delay?: number;
}

type Grade = "bad" | "warn" | "good";

function gradeOf(score: number): Grade {
  if (score < 50) return "bad";
  if (score < 75) return "warn";
  return "good";
}

const GRADE_TEXT: Record<Grade, string> = {
  bad: "Needs work",
  warn: "Building",
  good: "Strong",
};

const GRADE_VAR: Record<Grade, string> = {
  bad: "var(--bad)",
  warn: "var(--warn)",
  good: "var(--good)",
};

const SIZE = 200;
const STROKE = 16;
const R = (SIZE - STROKE) / 2;
const C = 2 * Math.PI * R;

export default function ScoreDial({
  label,
  score,
  sublabel,
  delay = 0,
}: ScoreDialProps) {
  const clamped = Math.max(0, Math.min(100, Math.round(score)));
  const grade = gradeOf(clamped);
  const color = GRADE_VAR[grade];

  // Count-up + ring sweep driven from a single animated value.
  const [shown, setShown] = useState(0);

  useEffect(() => {
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      setShown(clamped);
      return;
    }
    const duration = 1100;
    const startAt = performance.now() + delay;
    let raf = 0;
    const tick = (now: number) => {
      const elapsed = now - startAt;
      if (elapsed < 0) {
        raf = requestAnimationFrame(tick);
        return;
      }
      const p = Math.min(1, elapsed / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      setShown(Math.round(eased * clamped));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [clamped, delay]);

  const offset = C * (1 - shown / 100);

  return (
    <div
      className="flex flex-col items-center text-center"
      role="img"
      aria-label={`${label}: ${clamped} out of 100 — ${GRADE_TEXT[grade]}`}
    >
      <div className="relative" style={{ width: SIZE, height: SIZE }}>
        <svg
          width={SIZE}
          height={SIZE}
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          className="-rotate-90"
          aria-hidden="true"
        >
          <circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={R}
            fill="none"
            stroke="var(--line)"
            strokeWidth={STROKE}
          />
          <circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={R}
            fill="none"
            stroke={color}
            strokeWidth={STROKE}
            strokeLinecap="round"
            strokeDasharray={C}
            strokeDashoffset={offset}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span
            className="font-display text-6xl font-semibold leading-none tabular-nums"
            style={{ color }}
          >
            {shown}
          </span>
          <span className="mt-1 font-mono text-[11px] uppercase tracking-[0.18em] text-muted">
            / 100
          </span>
        </div>
      </div>

      <h3 className="mt-5 font-display text-xl font-semibold text-ink">{label}</h3>
      <span
        className="mt-2 inline-flex items-center gap-1.5 rounded-full border px-3 py-1 font-mono text-[11px] font-medium uppercase tracking-[0.14em]"
        style={{ color, borderColor: color }}
      >
        <span
          className="h-1.5 w-1.5 rounded-full"
          style={{ backgroundColor: color }}
        />
        {GRADE_TEXT[grade]}
      </span>
      {sublabel && (
        <p className="mt-3 max-w-[15rem] text-sm leading-relaxed text-muted">
          {sublabel}
        </p>
      )}
    </div>
  );
}
