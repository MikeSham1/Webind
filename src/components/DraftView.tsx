"use client";

import { useActionState, useState } from "react";
import { decideDraftAction } from "@/app/studio/actions";
import { initialDecisionState } from "@/app/studio/state";
import type { ContentDraft, GateResult } from "@/lib/content/types";

const STATUS_STYLES: Record<GateResult["status"], string> = {
  pass: "text-good border-good/40",
  warn: "text-warn border-warn/40",
  block: "text-bad border-bad/40",
  info: "text-muted border-line-strong",
};

const STATUS_LABEL: Record<GateResult["status"], string> = {
  pass: "Pass",
  warn: "Review",
  block: "Blocked",
  info: "Info",
};

export default function DraftView({
  draft,
  draftId,
}: {
  draft: ContentDraft;
  draftId: string | null;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(draft.markdown);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard unavailable */
    }
  }

  return (
    <section className="space-y-6">
      {/* Safety gates */}
      <div className="rounded-2xl border border-line bg-surface p-6">
        <h2 className="font-display text-xl font-semibold text-ink">
          Safety checks
        </h2>
        <ul className="mt-4 space-y-3">
          {draft.gates.results.map((g) => (
            <li key={g.key} className="flex items-start gap-3">
              <span
                className={`mt-0.5 shrink-0 rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider ${STATUS_STYLES[g.status]}`}
              >
                {STATUS_LABEL[g.status]}
              </span>
              <div>
                <p className="font-sans text-sm font-medium text-ink">{g.label}</p>
                <p className="text-sm text-muted">{g.detail}</p>
              </div>
            </li>
          ))}
        </ul>
      </div>

      {/* Draft */}
      <div className="overflow-hidden rounded-2xl border border-line bg-surface">
        <div className="flex items-center justify-between gap-4 border-b border-line p-5">
          <h2 className="font-display text-xl font-semibold text-ink">
            {draft.title || "Draft"}
          </h2>
          <button
            type="button"
            onClick={copy}
            className="shrink-0 rounded-full border border-line-strong px-4 py-1.5 font-sans text-sm font-medium text-ink transition-colors hover:border-accent hover:text-accent"
          >
            {copied ? "Copied ✓" : "Copy markdown"}
          </button>
        </div>
        <pre className="max-h-[28rem] overflow-auto whitespace-pre-wrap bg-paper p-5 font-mono text-[13px] leading-relaxed text-ink">
          <code>{draft.markdown}</code>
        </pre>
      </div>

      <DecisionBar draftId={draftId} blocked={draft.gates.blocked} />
    </section>
  );
}

function DecisionBar({
  draftId,
  blocked,
}: {
  draftId: string | null;
  blocked: boolean;
}) {
  const [state, formAction, isPending] = useActionState(
    decideDraftAction,
    initialDecisionState,
  );

  if (!draftId) {
    return (
      <p className="rounded-xl border border-line bg-surface px-4 py-3 text-sm text-muted">
        This draft wasn&apos;t saved (database not configured), so there&apos;s
        nothing to approve — but you can copy it above. Configure a database to
        enable saving and the approval workflow.
      </p>
    );
  }

  if (state.status === "done") {
    return (
      <p
        role="status"
        className={`rounded-xl border px-4 py-3 text-sm font-medium ${
          state.decision === "approved"
            ? "border-good/40 text-good"
            : "border-bad/40 text-bad"
        }`}
      >
        {state.decision === "approved"
          ? "Approved. This content is marked ready to use."
          : "Rejected. This draft won't be used."}
      </p>
    );
  }

  return (
    <form action={formAction} className="flex flex-wrap items-center gap-3">
      <input type="hidden" name="draftId" value={draftId} />
      <button
        type="submit"
        name="decision"
        value="approve"
        disabled={isPending || blocked}
        title={blocked ? "Resolve the blocked safety check first" : undefined}
        className="inline-flex h-11 items-center justify-center rounded-full bg-accent px-6 font-sans text-[15px] font-semibold text-accent-ink transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
      >
        Approve
      </button>
      <button
        type="submit"
        name="decision"
        value="reject"
        disabled={isPending}
        className="inline-flex h-11 items-center justify-center rounded-full border border-line-strong px-6 font-sans text-[15px] font-medium text-ink transition-colors hover:border-bad hover:text-bad disabled:opacity-50"
      >
        Reject
      </button>
      {blocked && (
        <span className="text-sm text-bad">
          A safety check is blocking — resolve it before approving.
        </span>
      )}
      {state.status === "error" && (
        <span role="alert" className="text-sm text-bad">
          {state.error}
        </span>
      )}
    </form>
  );
}
