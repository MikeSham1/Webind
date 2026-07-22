import type { ReportResult } from "@/lib/scoring/types";
import ScoreDial from "./ScoreDial";
import SignalBreakdown from "./SignalBreakdown";
import FixList from "./FixList";

export interface ReportResultsProps {
  report: ReportResult;
  /** Optional plain-English summary shown above the dials. */
  narrative?: string;
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

export default function ReportResults({
  report,
  narrative,
}: ReportResultsProps) {
  const host = hostOf(report.url);

  return (
    <div className="space-y-14">
      {/* Header */}
      <div className="reveal text-center">
        <p className="font-mono text-xs uppercase tracking-[0.22em] text-muted">
          Authority Report
        </p>
        <h2 className="mt-2 font-display text-3xl font-semibold text-ink">
          {host}
        </h2>
        {narrative && (
          <p className="mx-auto mt-5 max-w-xl text-[15px] leading-relaxed text-muted">
            {narrative}
          </p>
        )}
      </div>

      {/* Dials */}
      <div className="reveal flex flex-col items-center justify-center gap-y-12 gap-x-20 sm:flex-row sm:items-start">
        <ScoreDial
          label="AI Authority"
          score={report.ai.total}
          sublabel="How likely AI models are to trust and cite you."
          delay={0}
        />
        <ScoreDial
          label="Traditional Authority"
          score={report.traditional.total}
          sublabel="How search engines read your page-level credibility."
          delay={160}
        />
      </div>

      {/* Signal breakdown */}
      <div
        className="reveal grid gap-6 lg:grid-cols-2"
        style={{ animationDelay: "80ms" }}
      >
        <SignalBreakdown title="AI Authority signals" score={report.ai} />
        <SignalBreakdown
          title="Traditional Authority signals"
          score={report.traditional}
        />
      </div>

      {/* Prioritized fixes */}
      <div className="reveal" style={{ animationDelay: "120ms" }}>
        <div className="mb-5 flex items-baseline justify-between gap-4">
          <h3 className="font-display text-2xl font-semibold text-ink">
            Your highest-impact fixes
          </h3>
          <span className="hidden font-mono text-xs uppercase tracking-[0.16em] text-muted sm:block">
            Ranked by impact
          </span>
        </div>
        <FixList fixes={report.prioritizedFixes} />
      </div>

      {/* Soft CTA */}
      <div
        className="reveal overflow-hidden rounded-2xl border border-accent/30 bg-surface p-8 text-center sm:p-10"
        style={{ animationDelay: "160ms" }}
      >
        <h3 className="mx-auto max-w-xl font-display text-2xl font-semibold text-ink sm:text-3xl">
          Turn these fixes into rankings with WeBind.
        </h3>
        <p className="mx-auto mt-3 max-w-md text-[15px] leading-relaxed text-muted">
          We implement every fix on this list, then monitor your AI and search
          authority as it climbs — done for you.
        </p>
        <button
          type="button"
          className="mt-6 inline-flex h-12 items-center justify-center rounded-full bg-accent px-7 font-sans text-[15px] font-semibold text-accent-ink transition-colors hover:bg-accent-hover"
        >
          Optimize with WeBind
        </button>
        <p className="mt-3 font-mono text-[11px] uppercase tracking-[0.16em] text-muted">
          Early access opening soon
        </p>
      </div>
    </div>
  );
}
