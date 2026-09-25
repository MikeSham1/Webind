"use client";

import { useActionState, useState, useTransition } from "react";
import { decideDraftAction, previewMarkdownAction } from "@/app/studio/actions";
import { initialDecisionState, type DecisionState } from "@/app/studio/state";
import type { ContentDraft, DraftStatus, GateResult } from "@/lib/content/types";
import PublishBar, { type PublicationSnapshot } from "./PublishBar";

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
  initialStatus = "pending_review",
  wordPressConnected = false,
  initialPublication = null,
  wordPressSiteUrl = null,
}: {
  draft: ContentDraft;
  draftId: string | null;
  /** Status this draft was saved with, e.g. reloading an already-approved draft from the dashboard. */
  initialStatus?: DraftStatus;
  wordPressConnected?: boolean;
  initialPublication?: PublicationSnapshot | null;
  /** The connected WordPress site this draft will actually publish to. */
  wordPressSiteUrl?: string | null;
}) {
  const [copied, setCopied] = useState(false);
  // Editable: the reviewer can tweak the draft before approving, and the edit
  // is captured as the training target (see decideDraftAction).
  const [markdown, setMarkdown] = useState(draft.markdown);
  const [decisionState, decisionFormAction, isDeciding] = useActionState(
    decideDraftAction,
    initialDecisionState,
  );

  // Preview renders through the SAME markdownToHtml() call publishing uses
  // (previewMarkdownAction just wraps it) — there is no separate preview
  // renderer that could silently drift from what actually reaches WordPress.
  const [showPreview, setShowPreview] = useState(false);
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [isPreviewing, startPreview] = useTransition();

  function togglePreview() {
    if (showPreview) {
      setShowPreview(false);
      return;
    }
    startPreview(async () => {
      setPreviewHtml(await previewMarkdownAction(markdown, draft.title));
      setShowPreview(true);
    });
  }

  const currentStatus: DraftStatus =
    decisionState.status === "done" ? decisionState.decision : initialStatus;
  const isApproved = currentStatus === "approved";
  const edited = markdown.trim() !== draft.markdown.trim();

  async function copy() {
    try {
      await navigator.clipboard.writeText(markdown);
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
          <div className="min-w-0">
            <h2 className="truncate font-display text-xl font-semibold text-ink">
              {draft.title || "Draft"}
            </h2>
            {draft.writtenBy && (
              <p className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-muted">
                {draft.writtenBy === "model" ? "Written by AI · review before use" : "Template draft"}
              </p>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={togglePreview}
              disabled={isPreviewing}
              className="rounded-full border border-line-strong px-4 py-1.5 font-sans text-sm font-medium text-ink transition-colors hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isPreviewing ? "Rendering…" : showPreview ? "Edit" : "Preview"}
            </button>
            <button
              type="button"
              onClick={copy}
              className="rounded-full border border-line-strong px-4 py-1.5 font-sans text-sm font-medium text-ink transition-colors hover:border-accent hover:text-accent"
            >
              {copied ? "Copied ✓" : "Copy markdown"}
            </button>
          </div>
        </div>
        {showPreview ? (
          <>
            {/* Safe: previewHtml is the sanitized output of markdownToHtml()
                (allowlisted tags/attributes only) — the same function that
                builds the HTML actually sent to WordPress, run server-side. */}
            <div
              className="prose-preview max-h-[28rem] min-h-[16rem] overflow-auto bg-paper p-5 text-[15px] leading-relaxed text-ink [&_a]:text-accent [&_a]:underline [&_h1]:font-display [&_h1]:text-2xl [&_h1]:font-semibold [&_h2]:font-display [&_h2]:text-xl [&_h2]:font-semibold [&_h3]:font-display [&_h3]:text-lg [&_h3]:font-semibold [&_li]:ml-5 [&_ul]:list-disc"
              dangerouslySetInnerHTML={{ __html: previewHtml ?? "" }}
            />
            <p className="border-t border-line px-5 py-2 font-mono text-[11px] uppercase tracking-[0.14em] text-muted">
              Preview — exactly what WordPress will receive
            </p>
          </>
        ) : (
          <textarea
            value={markdown}
            onChange={(e) => !isApproved && setMarkdown(e.target.value)}
            readOnly={isApproved}
            spellCheck={false}
            aria-label={isApproved ? "Draft markdown (locked — already approved)" : "Draft markdown (editable)"}
            className={`block max-h-[28rem] min-h-[16rem] w-full resize-y overflow-auto bg-paper p-5 font-mono text-[13px] leading-relaxed text-ink focus:outline-none ${isApproved ? "cursor-default opacity-80" : ""}`}
          />
        )}
        {isApproved ? (
          <p className="border-t border-line px-5 py-2 font-mono text-[11px] uppercase tracking-[0.14em] text-muted">
            Locked — this is the exact text that was approved and will publish
          </p>
        ) : (
          edited && (
            <p className="border-t border-line px-5 py-2 font-mono text-[11px] uppercase tracking-[0.14em] text-muted">
              Edited — your version is saved as the approved copy
            </p>
          )
        )}
      </div>

      <DecisionBar
        draftId={draftId}
        blocked={draft.gates.blocked}
        markdown={markdown}
        state={decisionState}
        formAction={decisionFormAction}
        isPending={isDeciding}
      />

      {draftId && currentStatus === "approved" && (
        <PublishBar
          draftId={draftId}
          wordPressConnected={wordPressConnected}
          initialPublication={initialPublication}
          siteUrl={wordPressSiteUrl}
        />
      )}
    </section>
  );
}

function DecisionBar({
  draftId,
  blocked,
  markdown,
  state,
  formAction,
  isPending,
}: {
  draftId: string | null;
  blocked: boolean;
  markdown: string;
  state: DecisionState;
  formAction: (formData: FormData) => void;
  isPending: boolean;
}) {
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
      {/* The (possibly edited) draft — captured as the approved training target. */}
      <input type="hidden" name="markdown" value={markdown} />
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
