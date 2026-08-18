import type { ReportResult } from "@/lib/scoring/types";
import type { OptimizationAssets as Assets } from "@/lib/optimize/assets";
import ScoreDial from "./ScoreDial";
import SignalBreakdown from "./SignalBreakdown";
import FixList from "./FixList";
import OptimizationAssets from "./OptimizationAssets";
import LeadCapture from "./LeadCapture";
import type { PrSnapshot } from "./OpenPrBar";
import { MODEL_META } from "@/lib/model/predict";
import Link from "next/link";

export interface ReportResultsProps {
  report: ReportResult;
  /** Optional plain-English summary shown above the dials. */
  narrative?: string;
  /** Ready-to-apply generated assets (schema, meta, llms.txt, robots). */
  optimizations?: Assets;
  /** DB id of the logged run; enables email capture and the "open a PR" action when present. */
  requestId?: string | null;
  githubConnected?: boolean;
  initialPr?: PrSnapshot | null;
  /**
   * Experimental Claude-distilled model prediction (0-100). Shown only on fresh
   * runs (the crawl is needed to compute it); omitted on saved-report views.
   */
  modelReadiness?: number;
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
  optimizations,
  requestId,
  githubConnected = false,
  initialPr = null,
  modelReadiness,
}: ReportResultsProps) {
  const host = hostOf(report.url);

  return (
    <div className="space-y-14">
      {/* Header */}
      <div className="reveal text-center">
        <p className="font-mono text-xs uppercase tracking-[0.22em] text-accent">
          <span aria-hidden="true">[ </span>
          Parse complete
          <span aria-hidden="true"> ]</span>
        </p>
        <h2 className="mt-2 font-display text-3xl font-semibold text-ink">
          {host}
        </h2>
        {narrative && (
          <p className="mx-auto mt-5 max-w-xl text-[15px] leading-relaxed text-muted">
            {narrative}
          </p>
        )}
        <p className="mt-3 font-mono text-[11px] uppercase tracking-[0.14em] text-muted">
          <Link href="/methodology" className="hover:text-accent">
            Methodology v{report.modelVersion}
          </Link>
        </p>
      </div>

      {/* Dials — the literal readout, so this is where the scan-frame signature
          gets its most deliberate use. */}
      <div className="scan-frame reveal flex flex-col items-center justify-center gap-y-12 gap-x-20 border border-line bg-surface px-8 py-12 sm:flex-row sm:items-start">
        <ScoreDial
          label="AI Readiness"
          score={report.ai.total}
          sublabel="How ready your page is to be understood and cited by AI models."
          delay={0}
        />
        <ScoreDial
          label="Traditional Authority"
          score={report.traditional.total}
          sublabel="How search engines read your page-level credibility."
          delay={160}
        />
      </div>

      {/* Experimental: Claude-distilled model prediction. Deliberately kept
          visually secondary to the heuristic dials and labeled honestly — it's
          distilled from Claude's judgment of structural signals, not measured
          real-world citations. */}
      {typeof modelReadiness === "number" && (
        <div className="reveal" style={{ animationDelay: "40ms" }}>
          <div className="mx-auto flex max-w-xl flex-col items-center gap-3 border border-dashed border-accent/40 bg-surface px-6 py-5 text-center sm:flex-row sm:justify-between sm:text-left">
            <div>
              <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-accent">
                <span aria-hidden="true">[ </span>
                Experimental · Claude-distilled model {MODEL_META.version}
                <span aria-hidden="true"> ]</span>
              </p>
              <p className="mt-1.5 text-sm leading-relaxed text-muted">
                A small neural net trained to imitate Claude&apos;s judgment of
                AI-readiness signals — held-out MAE {MODEL_META.testMAE}, not
                calibrated to real citations.{" "}
                <Link href="/methodology" className="text-accent hover:underline">
                  How it works
                </Link>
              </p>
            </div>
            <div className="shrink-0">
              <span className="font-display text-4xl font-semibold tabular-nums text-ink">
                {modelReadiness}
              </span>
              <span className="ml-1 font-mono text-[11px] uppercase tracking-[0.16em] text-muted">
                / 100
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Signal breakdown */}
      <div
        className="reveal grid gap-6 lg:grid-cols-2"
        style={{ animationDelay: "80ms" }}
      >
        <SignalBreakdown title="AI Readiness signals" score={report.ai} />
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

      {/* Ready-to-apply generated assets */}
      {optimizations && (
        <OptimizationAssets
          assets={optimizations}
          requestId={requestId}
          githubConnected={githubConnected}
          initialPr={initialPr}
        />
      )}

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
        {requestId ? (
          <LeadCapture requestId={requestId} />
        ) : (
          <>
            <button
              type="button"
              className="mt-6 inline-flex h-12 items-center justify-center rounded-full bg-accent px-7 font-sans text-[15px] font-semibold text-accent-ink transition-colors hover:bg-accent-hover"
            >
              Optimize with WeBind
            </button>
            <p className="mt-3 font-mono text-[11px] uppercase tracking-[0.16em] text-muted">
              Early access opening soon
            </p>
          </>
        )}
      </div>
    </div>
  );
}
