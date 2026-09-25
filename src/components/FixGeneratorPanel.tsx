"use client";

import { useActionState, useState } from "react";
import {
  generateFixAction,
  markFixDeployedAction,
  submitReviewAction,
} from "@/app/fixgen/actions";
import {
  initialDeployState,
  initialFixGenState,
  initialReviewState,
  type ReviewCandidate,
} from "@/app/fixgen/state";

const NO_FIX_COPY: Record<string, string> = {
  already_optimal: "This is already in good shape — no change needed.",
  not_applicable: "This fix doesn't apply to this page.",
  insufficient_evidence: "There isn't enough on-page evidence to write a safe fix.",
  low_expected_value: "The likely impact is too small to be worth a change.",
  conflicts_with_page_intent: "A change here would conflict with the page's purpose.",
  requires_site_level_change: "This needs a site-wide change, not a single-page edit.",
  requires_external_information: "This needs information the page doesn't contain.",
  unsafe_to_automate: "This isn't safe to generate automatically.",
};

/** Review controls for one validated candidate. */
function CandidateReview({ item }: { item: ReviewCandidate }) {
  const [state, action, pending] = useActionState(submitReviewAction, initialReviewState);
  const [mode, setMode] = useState<"idle" | "edit" | "reject">("idle");
  const c = item.candidate;
  const disabled = item.dbId === "";

  if (state.status === "saved") {
    const accepted = state.decision.startsWith("accepted");
    return (
      <div className="mt-3">
        <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-good">
          Saved · {state.decision.replace(/_/g, " ")}
        </p>
        {accepted && <DeployControl candidateId={state.candidateId} />}
      </div>
    );
  }

  return (
    <div className="mt-3 border-t border-line pt-3">
      {state.status === "error" && (
        <p role="alert" className="mb-2 text-sm text-bad">
          {state.error}
        </p>
      )}

      {mode === "idle" && (
        <div className="flex flex-wrap gap-2">
          <form action={action}>
            <input type="hidden" name="candidateId" value={item.dbId} />
            <input type="hidden" name="decision" value="accepted_unedited" />
            <button
              type="submit"
              disabled={pending || disabled}
              className="rounded-full bg-accent px-4 py-1.5 font-sans text-sm font-semibold text-accent-ink transition-colors hover:bg-accent-hover disabled:opacity-60"
            >
              Accept
            </button>
          </form>
          <button
            type="button"
            onClick={() => setMode("edit")}
            disabled={disabled}
            className="rounded-full border border-line px-4 py-1.5 font-sans text-sm font-medium text-ink hover:border-accent hover:text-accent disabled:opacity-60"
          >
            Edit &amp; accept
          </button>
          <button
            type="button"
            onClick={() => setMode("reject")}
            disabled={disabled}
            className="rounded-full border border-line px-4 py-1.5 font-sans text-sm font-medium text-muted hover:border-bad hover:text-bad disabled:opacity-60"
          >
            Reject
          </button>
        </div>
      )}

      {mode === "edit" && (
        <form action={action} className="space-y-2">
          <input type="hidden" name="candidateId" value={item.dbId} />
          <input type="hidden" name="decision" value="accepted_minor_edit" />
          <label className="block font-mono text-[11px] uppercase tracking-[0.14em] text-muted">
            Your final version
          </label>
          <textarea
            name="humanFinal"
            defaultValue={c.after ?? ""}
            rows={4}
            className="w-full border border-line bg-paper p-2 font-mono text-sm text-ink focus:border-accent focus:outline-none"
          />
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={pending}
              className="rounded-full bg-accent px-4 py-1.5 font-sans text-sm font-semibold text-accent-ink hover:bg-accent-hover disabled:opacity-60"
            >
              Save edited &amp; accept
            </button>
            <button
              type="button"
              onClick={() => setMode("idle")}
              className="rounded-full border border-line px-4 py-1.5 font-sans text-sm text-muted"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {mode === "reject" && (
        <form action={action} className="space-y-2">
          <input type="hidden" name="candidateId" value={item.dbId} />
          <input type="hidden" name="decision" value="rejected" />
          <label className="block font-mono text-[11px] uppercase tracking-[0.14em] text-muted">
            Why? (one line — helps the model learn)
          </label>
          <input
            name="rejectionReason"
            className="w-full border border-line bg-paper p-2 font-sans text-sm text-ink focus:border-accent focus:outline-none"
          />
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={pending}
              className="rounded-full border border-bad px-4 py-1.5 font-sans text-sm font-semibold text-bad disabled:opacity-60"
            >
              Reject
            </button>
            <button
              type="button"
              onClick={() => setMode("idle")}
              className="rounded-full border border-line px-4 py-1.5 font-sans text-sm text-muted"
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

/**
 * After a fix is accepted, let the reviewer record that it actually shipped —
 * optionally with a link to the live change (PR, commit, post). This logs the
 * deployment event for the learning dataset; it does not push anything live.
 */
function DeployControl({ candidateId }: { candidateId: string }) {
  const [state, action, pending] = useActionState(markFixDeployedAction, initialDeployState);

  if (state.status === "recorded") {
    return (
      <p className="mt-2 font-mono text-[11px] uppercase tracking-[0.14em] text-muted">
        Deployment recorded
      </p>
    );
  }

  return (
    <form action={action} className="mt-2 flex flex-wrap items-center gap-2">
      <input type="hidden" name="candidateId" value={candidateId} />
      <input type="hidden" name="target" value="manual" />
      <input
        name="ref"
        placeholder="Link to the live change (optional)"
        className="min-w-0 flex-1 rounded-lg border border-line bg-paper px-3 py-1.5 font-sans text-xs text-ink placeholder:text-muted/60 focus-visible:border-accent focus-visible:outline-none"
      />
      <button
        type="submit"
        disabled={pending}
        className="whitespace-nowrap rounded-full border border-line px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-muted transition-colors hover:border-accent hover:text-accent disabled:opacity-50"
      >
        {pending ? "Saving…" : "Mark as deployed"}
      </button>
      {state.status === "error" && (
        <span role="alert" className="w-full text-xs text-bad">
          {state.error}
        </span>
      )}
    </form>
  );
}

export default function FixGeneratorPanel({ requestId }: { requestId: string }) {
  const [state, action, pending] = useActionState(generateFixAction, initialFixGenState);

  return (
    <section className="scan-frame border border-line bg-surface p-6 sm:p-7">
      <header className="border-b-2 border-line-strong pb-4">
        <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-accent">
          Fix Generator · experimental
        </p>
        <p className="mt-1.5 text-sm leading-relaxed text-muted">
          Generate a small, evidence-grounded fix for review — every candidate is
          drawn only from your page&apos;s own content, validated automatically,
          and applied only if you accept it. Powered by Gemini.
        </p>
      </header>

      <form action={action} className="mt-4 flex flex-wrap gap-2">
        <input type="hidden" name="requestId" value={requestId} />
        <button
          type="submit"
          name="category"
          value="metadata"
          disabled={pending}
          className="rounded-full border border-line px-4 py-1.5 font-sans text-sm font-medium text-ink hover:border-accent hover:text-accent disabled:opacity-60"
        >
          {pending ? "Generating…" : "Generate meta description"}
        </button>
        <button
          type="submit"
          name="category"
          value="schema"
          disabled={pending}
          className="rounded-full border border-line px-4 py-1.5 font-sans text-sm font-medium text-ink hover:border-accent hover:text-accent disabled:opacity-60"
        >
          {pending ? "Generating…" : "Generate structured data"}
        </button>
      </form>

      {state.status === "error" && (
        <p role="alert" className="mt-4 border border-bad/40 bg-surface px-4 py-3 text-sm text-ink">
          <span className="font-semibold text-bad">Couldn&apos;t generate. </span>
          {state.error}
        </p>
      )}

      {state.status === "no_fix" && (
        <p className="mt-4 border border-good/40 bg-surface px-4 py-3 text-sm text-ink">
          <span className="font-semibold text-good">No fix. </span>
          {NO_FIX_COPY[state.reason] ?? "No change recommended."}
        </p>
      )}

      {state.status === "candidates" && (
        <div className="mt-5 space-y-4">
          {state.candidates.map((item) => (
            <article key={item.candidate.candidateId} className="border border-line bg-paper p-4">
              <div className="mb-2 flex items-center justify-between gap-3">
                <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted">
                  {state.category} · confidence {item.candidate.confidence}
                </span>
                {item.candidate.evidenceSpanIds.length > 0 && (
                  <span className="font-mono text-[11px] text-muted">
                    cites {item.candidate.evidenceSpanIds.join(", ")}
                  </span>
                )}
              </div>
              <pre className="overflow-x-auto whitespace-pre-wrap break-words border border-line bg-surface p-3 font-mono text-[13px] text-ink">
                {item.candidate.after}
              </pre>
              {item.candidate.rationale && (
                <p className="mt-2 text-sm leading-relaxed text-muted">{item.candidate.rationale}</p>
              )}
              <CandidateReview item={item} />
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
