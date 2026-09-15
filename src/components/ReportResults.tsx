import type { ActionableSuggestion, ReportResult } from "@/lib/scoring/types";
import type { OptimizationAssets as Assets } from "@/lib/optimize/assets";
import { computeStages } from "@/lib/scoring/stages";
import { PAGE_TYPE_LABEL } from "@/lib/scoring/page-type";
import ScoreDial from "./ScoreDial";
import StageBreakdown from "./StageBreakdown";
import PageExperience from "./PageExperience";
import ScoreAuditPanel from "./ScoreAuditPanel";
import SignalBreakdown from "./SignalBreakdown";
import type { FieldVitals } from "@/lib/vitals/types";
import type { ScoreAudit } from "@/lib/scoring/audit";
import FixList from "./FixList";
import AiBubble from "./AiBubble";
import OptimizationAssets from "./OptimizationAssets";
import LeadCapture from "./LeadCapture";
import type { PrSnapshot } from "./OpenPrBar";
import Link from "next/link";

export interface ReportResultsProps {
  report: ReportResult;
  /** Optional plain-English summary shown above the dials. */
  narrative?: string;
  /** True when `narrative` was written by the AI (shows an AI chat bubble). */
  narrativeIsAi?: boolean;
  /** Rich, page-grounded fix suggestions; falls back to plain fixes when absent. */
  suggestions?: ActionableSuggestion[];
  /** True when the detailed suggestions are paywalled (upgrade to unlock). */
  suggestionsLocked?: boolean;
  /** Ready-to-apply generated assets (schema, meta, llms.txt, robots). */
  optimizations?: Assets;
  /** DB id of the logged run; enables email capture and the "open a PR" action when present. */
  requestId?: string | null;
  githubConnected?: boolean;
  initialPr?: PrSnapshot | null;
  /**
   * Experimental Claude-distilled model prediction (0-100). Retained on the
   * report state for internal/experiment use, but NOT rendered in the customer
   * report: it's distilled from an older synthetic teacher whose assumptions
   * the current scorer has since corrected, so it can disagree with the
   * heuristic dials and read as a misleading "second opinion". Keep it out of
   * the customer UX until it's retrained on real outcome data.
   */
  modelReadiness?: number;
  /** Core Web Vitals field data (CrUX via PSI), or null when unavailable. */
  pageExperience?: FieldVitals | null;
  /** Admin-only LLM score audit, or null. */
  scoreAudit?: ScoreAudit | null;
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
  narrativeIsAi = false,
  suggestions,
  suggestionsLocked = false,
  optimizations,
  requestId,
  githubConnected = false,
  initialPr = null,
  pageExperience = null,
  scoreAudit = null,
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
        {report.pageType && (
          <p className="mt-2 font-mono text-[11px] uppercase tracking-[0.16em] text-muted">
            Scored as: {PAGE_TYPE_LABEL[report.pageType]}
          </p>
        )}
        {narrative &&
          (narrativeIsAi ? (
            <AiBubble>{narrative}</AiBubble>
          ) : (
            <p className="mx-auto mt-5 max-w-xl text-[15px] leading-relaxed text-muted">
              {narrative}
            </p>
          ))}
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

      {/* The experimental Claude-distilled model score used to render here. It's
          been pulled from the customer report: distilled from an older synthetic
          teacher the current scorer no longer agrees with, it read as a
          misleading second opinion. It stays computed on the report state for
          internal evaluation until it's retrained on real outcomes. */}

      {/* Stage vector — the visibility pipeline underneath the headline scores. */}
      <div className="reveal" style={{ animationDelay: "60ms" }}>
        <StageBreakdown stages={computeStages(report)} />
      </div>

      {/* Core Web Vitals — real-user field data, only when CrUX has it. */}
      {pageExperience && (
        <div className="reveal" style={{ animationDelay: "70ms" }}>
          <PageExperience vitals={pageExperience} />
        </div>
      )}

      {/* Admin-only LLM score audit. */}
      {scoreAudit?.configured && (
        <div className="reveal" style={{ animationDelay: "75ms" }}>
          <ScoreAuditPanel audit={scoreAudit} />
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
            {suggestionsLocked
              ? "Ranked by impact"
              : suggestions?.some((s) => s.aiGenerated)
                ? "AI-tailored to your page"
                : "Ranked by impact"}
          </span>
        </div>
        <FixList
          fixes={report.prioritizedFixes}
          suggestions={suggestions}
          locked={suggestionsLocked}
        />
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
