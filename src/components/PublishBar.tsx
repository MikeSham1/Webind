"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import {
  confirmGoLiveAction,
  publishDraftAction,
  rollbackPublicationAction,
} from "@/app/studio/actions";
import { initialPublishState, type PublishState } from "@/app/studio/state";

/** Mirrors PublishState's non-idle, non-error variants — what a page load can know in advance. */
export type PublicationSnapshot =
  | { status: "wp_draft"; previewUrl: string; editUrl: string }
  | { status: "published"; viewUrl: string; editUrl: string }
  | { status: "rolled_back" };

/** The subset of PublishState this component keeps as its "known step" — never "error". */
type KnownState = Exclude<PublishState, { status: "error" }>;

const IDLE: KnownState = { status: "idle" };

function toKnownState(snapshot: PublicationSnapshot | null): KnownState {
  return snapshot ?? IDLE;
}

/**
 * One-click apply: publish an approved draft to the connected WordPress site,
 * or roll it back. Two independent checkpoints before anything is publicly
 * visible: the page is created on WordPress as a DRAFT first (never live),
 * then a separate, explicitly-confirmed step ("Confirm & go live") brings it
 * live — only after the user has had the chance to review the actual
 * WordPress draft via its preview link.
 *
 * `state` always holds the last KNOWN step (idle / wp_draft / published /
 * rolled_back) and is never itself set to "error" — a failed attempt to go
 * live or roll back does not erase the fact that the WordPress draft (or live
 * page) still exists. `error` is tracked separately so a failure shows
 * alongside whatever step we're actually still in, instead of resetting the
 * whole UI back to "create a new draft".
 */
export default function PublishBar({
  draftId,
  wordPressConnected,
  initialPublication,
}: {
  draftId: string;
  wordPressConnected: boolean;
  initialPublication: PublicationSnapshot | null;
}) {
  const [state, setState] = useState<KnownState>(toKnownState(initialPublication));
  const [error, setError] = useState<string | null>(null);
  const [confirmingGoLive, setConfirmingGoLive] = useState(false);
  const [isPending, startTransition] = useTransition();

  function run(action: typeof publishDraftAction | typeof rollbackPublicationAction | typeof confirmGoLiveAction) {
    const formData = new FormData();
    formData.set("draftId", draftId);
    startTransition(async () => {
      const result = await action(initialPublishState, formData);
      if (result.status === "error") {
        setError(result.error);
      } else {
        setError(null);
        setState(result);
        setConfirmingGoLive(false);
      }
    });
  }

  if (!wordPressConnected) {
    return (
      <p className="rounded-xl border border-line bg-surface px-4 py-3 text-sm text-muted">
        <Link href="/dashboard/settings" className="font-medium text-accent hover:underline">
          Connect WordPress
        </Link>{" "}
        in Settings to publish this live.
      </p>
    );
  }

  if (state.status === "published") {
    return (
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-4 rounded-xl border border-good/40 bg-surface px-4 py-3">
          <span className="text-sm font-medium text-good">Live on WordPress.</span>
          <a
            href={state.viewUrl}
            target="_blank"
            rel="noreferrer"
            className="text-sm font-medium text-accent hover:underline"
          >
            View ↗
          </a>
          <button
            type="button"
            onClick={() => run(rollbackPublicationAction)}
            disabled={isPending}
            className="ml-auto rounded-full border border-line-strong px-4 py-1.5 font-sans text-sm font-medium text-ink transition-colors hover:border-bad hover:text-bad disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isPending ? "Rolling back…" : "Roll back"}
          </button>
        </div>
        {error && (
          <span role="alert" className="block text-sm text-bad">
            {error}
          </span>
        )}
      </div>
    );
  }

  if (state.status === "wp_draft") {
    return (
      <div className="space-y-3 rounded-xl border border-line bg-surface px-4 py-4">
        <div className="flex flex-wrap items-center gap-4">
          <span className="text-sm font-medium text-ink">
            Created as a draft on WordPress — not public yet.
          </span>
          <a
            href={state.previewUrl}
            target="_blank"
            rel="noreferrer"
            className="text-sm font-medium text-accent hover:underline"
          >
            Preview on WordPress ↗
          </a>
        </div>

        {!confirmingGoLive ? (
          <button
            type="button"
            onClick={() => setConfirmingGoLive(true)}
            disabled={isPending}
            className="inline-flex h-11 items-center justify-center rounded-full bg-accent px-6 font-sans text-[15px] font-semibold text-accent-ink transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-70"
          >
            Confirm & go live
          </button>
        ) : (
          <div className="rounded-lg border border-warn/40 bg-paper p-4">
            <p className="text-sm text-ink">
              Review the draft above first. This will make it publicly visible
              on your WordPress site — there&apos;s no undo except manually
              rolling it back afterward.
            </p>
            <div className="mt-3 flex gap-3">
              <button
                type="button"
                onClick={() => run(confirmGoLiveAction)}
                disabled={isPending}
                className="inline-flex h-10 items-center justify-center rounded-full bg-accent px-5 font-sans text-sm font-semibold text-accent-ink transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-70"
              >
                {isPending ? "Publishing…" : "Yes, publish live"}
              </button>
              <button
                type="button"
                onClick={() => setConfirmingGoLive(false)}
                disabled={isPending}
                className="inline-flex h-10 items-center justify-center rounded-full border border-line-strong px-5 font-sans text-sm font-medium text-ink transition-colors hover:border-bad hover:text-bad disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {error && (
          <span role="alert" className="block text-sm text-bad">
            {error}
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        type="button"
        onClick={() => run(publishDraftAction)}
        disabled={isPending}
        className="inline-flex h-11 items-center justify-center rounded-full bg-accent px-6 font-sans text-[15px] font-semibold text-accent-ink transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-70"
      >
        {isPending ? "Creating draft…" : "Publish to WordPress"}
      </button>
      <span className="text-xs text-muted">Creates a draft first — not live immediately.</span>
      {state.status === "rolled_back" && !error && (
        <span className="text-sm text-muted">Rolled back — not live.</span>
      )}
      {error && (
        <span role="alert" className="text-sm text-bad">
          {error}
        </span>
      )}
    </div>
  );
}
