"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { publishDraftAction, rollbackPublicationAction } from "@/app/studio/actions";
import { initialPublishState, type PublishState } from "@/app/studio/state";

export interface PublicationSnapshot {
  viewUrl: string;
  editUrl: string;
  status: "published" | "rolled_back";
}

function toPublishState(snapshot: PublicationSnapshot | null): PublishState {
  if (snapshot?.status === "published") {
    return { status: "published", viewUrl: snapshot.viewUrl, editUrl: snapshot.editUrl };
  }
  return initialPublishState;
}

/**
 * One-click apply: publish an approved draft to the connected WordPress site,
 * or roll it back. A single piece of local state (not two independent
 * `useActionState` hooks) so whichever action ran last is always what's shown.
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
  const [state, setState] = useState<PublishState>(toPublishState(initialPublication));
  const [isPending, startTransition] = useTransition();

  function run(action: typeof publishDraftAction | typeof rollbackPublicationAction) {
    const formData = new FormData();
    formData.set("draftId", draftId);
    startTransition(async () => {
      setState(await action(state, formData));
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
        {isPending ? "Publishing…" : "Publish to WordPress"}
      </button>
      {state.status === "rolled_back" && (
        <span className="text-sm text-muted">Rolled back — not live.</span>
      )}
      {state.status === "error" && (
        <span role="alert" className="text-sm text-bad">
          {state.error}
        </span>
      )}
    </div>
  );
}
