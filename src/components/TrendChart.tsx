export interface TrendPoint {
  date: string | Date;
  aiTotal: number | null;
  traditionalTotal: number | null;
}

export interface TrendChartProps {
  points: TrendPoint[];
}

const WIDTH = 720;
const HEIGHT = 220;
const PAD_X = 8;
const PAD_TOP = 12;
const PAD_BOTTOM = 28;

function pathFor(
  values: (number | null)[],
  xStep: number,
  plotHeight: number,
): string {
  let d = "";
  values.forEach((v, i) => {
    if (v === null) return;
    const x = PAD_X + i * xStep;
    const y = PAD_TOP + plotHeight * (1 - v / 100);
    d += d ? ` L ${x} ${y}` : `M ${x} ${y}`;
  });
  return d;
}

/** A score-over-time read for one tracked domain — solid line is AI Readiness
 * (the metric this product is built around), dashed is Traditional Authority,
 * distinguished by stroke style rather than a second brand color. */
export default function TrendChart({ points }: TrendChartProps) {
  const plotWidth = WIDTH - PAD_X * 2;
  const plotHeight = HEIGHT - PAD_TOP - PAD_BOTTOM;
  const xStep = points.length > 1 ? plotWidth / (points.length - 1) : 0;

  const aiValues = points.map((p) => p.aiTotal);
  const traditionalValues = points.map((p) => p.traditionalTotal);

  return (
    <div className="scan-frame border border-line bg-surface p-6">
      <div className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-2 font-mono text-[11px] uppercase tracking-[0.14em] text-muted">
        <span className="inline-flex items-center gap-2">
          <span className="h-0.5 w-4 bg-accent" aria-hidden="true" />
          AI Readiness
        </span>
        <span className="inline-flex items-center gap-2">
          <span
            className="h-0.5 w-4 bg-muted"
            style={{
              backgroundImage:
                "repeating-linear-gradient(to right, var(--muted) 0 3px, transparent 3px 6px)",
            }}
            aria-hidden="true"
          />
          Traditional Authority
        </span>
      </div>

      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="w-full"
        role="img"
        aria-label="Score trend over time for this site"
      >
        {[0, 25, 50, 75, 100].map((mark) => {
          const y = PAD_TOP + plotHeight * (1 - mark / 100);
          return (
            <g key={mark}>
              <line
                x1={PAD_X}
                y1={y}
                x2={WIDTH - PAD_X}
                y2={y}
                stroke="var(--line)"
                strokeWidth={1}
              />
              <text
                x={0}
                y={y - 3}
                className="font-mono"
                fontSize={9}
                fill="var(--muted)"
              >
                {mark}
              </text>
            </g>
          );
        })}

        <path
          d={pathFor(traditionalValues, xStep, plotHeight)}
          fill="none"
          stroke="var(--muted)"
          strokeWidth={2}
          strokeDasharray="3 4"
        />
        <path
          d={pathFor(aiValues, xStep, plotHeight)}
          fill="none"
          stroke="var(--accent)"
          strokeWidth={2.5}
        />

        {points.map((p, i) => {
          const x = PAD_X + i * xStep;
          return (
            <g key={i}>
              {p.aiTotal !== null && (
                <circle
                  cx={x}
                  cy={PAD_TOP + plotHeight * (1 - p.aiTotal / 100)}
                  r={3}
                  fill="var(--accent)"
                />
              )}
              <text
                x={x}
                y={HEIGHT - 6}
                textAnchor={i === 0 ? "start" : i === points.length - 1 ? "end" : "middle"}
                className="font-mono"
                fontSize={9}
                fill="var(--muted)"
              >
                {new Date(p.date).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                })}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
