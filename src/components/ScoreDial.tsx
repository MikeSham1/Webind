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
const STROKE = 14;
const R = (SIZE - STROKE) / 2;
const C = 2 * Math.PI * R;
// Ticks sit just inside the ring, between the arc and the numeral — a
// calibration-gauge read without needing extra canvas beyond the ring.
const TICK_R_OUTER = R - STROKE / 2 - 3;
const TICK_R_INNER_MAJOR = TICK_R_OUTER - 11;
const TICK_R_INNER_MINOR = TICK_R_OUTER - 6;

/** 10 ticks (every 10 points) around the full circle, gauge-style; every 5th is major. */
const TICKS = Array.from({ length: 10 }, (_, i) => {
  const angle = (i / 10) * 2 * Math.PI - Math.PI / 2;
  const major = i % 5 === 0;
  const rInner = major ? TICK_R_INNER_MAJOR : TICK_R_INNER_MINOR;
  const cx = SIZE / 2;
  const cy = SIZE / 2;
  return {
    key: i,
    x1: cx + rInner * Math.cos(angle),
    y1: cy + rInner * Math.sin(angle),
    x2: cx + TICK_R_OUTER * Math.cos(angle),
    y2: cy + TICK_R_OUTER * Math.sin(angle),
    major,
  };
});

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
    // Reduced motion is the same animation with no duration and no delay: it
    // lands on the final value in the first frame. Folding it into one path
    // keeps the state update inside the rAF callback, where it belongs —
    // setting state straight from the effect body triggers a cascading render.
    const duration = reduce ? 0 : 1100;
    const startAt = performance.now() + (reduce ? 0 : delay);
    let raf = 0;
    const tick = (now: number) => {
      const elapsed = now - startAt;
      if (elapsed < 0) {
        raf = requestAnimationFrame(tick);
        return;
      }
      const p = duration === 0 ? 1 : Math.min(1, elapsed / duration);
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
        {/* Gauge ticks + crosshair — drawn upright (not rotated with the arc
            above) since tick 0 is computed directly for the 12 o'clock start. */}
        <svg
          width={SIZE}
          height={SIZE}
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          className="absolute inset-0"
          aria-hidden="true"
        >
          {TICKS.map((t) => (
            <line
              key={t.key}
              x1={t.x1}
              y1={t.y1}
              x2={t.x2}
              y2={t.y2}
              stroke="var(--muted)"
              strokeWidth={t.major ? 1.5 : 1}
              opacity={t.major ? 0.55 : 0.3}
            />
          ))}
          <line
            x1={SIZE / 2 - 5}
            y1={SIZE / 2}
            x2={SIZE / 2 + 5}
            y2={SIZE / 2}
            stroke="var(--muted)"
            strokeWidth={1}
            opacity={0.4}
          />
          <line
            x1={SIZE / 2}
            y1={SIZE / 2 - 5}
            x2={SIZE / 2}
            y2={SIZE / 2 + 5}
            stroke="var(--muted)"
            strokeWidth={1}
            opacity={0.4}
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
        className="mt-2 inline-flex items-center gap-2 border-x-2 px-3 py-1 font-mono text-[11px] font-medium uppercase tracking-[0.14em]"
        style={{ color, borderColor: color }}
      >
        <span
          className="h-1.5 w-1.5"
          style={{ backgroundColor: color }}
          aria-hidden="true"
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
