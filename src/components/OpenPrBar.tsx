"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { openFixPrAction } from "@/app/actions";
import { initialPrState, type PrState } from "@/app/report-state";

export interface PrSnapshot {
  prUrl: string;
  prNumber: number;
}

/**
 * Phase 3 one-click apply: open a pull request with the file-shaped fixes
 * (llms.txt, robots.txt) on the report owner's connected GitHub repo. No
 * rollback control here — closing an unwanted PR is the user's own call on
 * GitHub, which is already a full review surface.
 */
export default function OpenPrBar({
  requestId,
  githubConnected,
  initialPr,
}: {
  requestId: string;
  githubConnected: boolean;
  initialPr: PrSnapshot | null;
}) {
  const [state, setState] = useState<PrState>(
    initialPr
      ? { status: "opened", prUrl: initialPr.prUrl, prNumber: initialPr.prNumber }
      : initialPrState,
  );
  const [isPending, startTransition] = useTransition();

  function open() {
    const formData = new FormData();
    formData.set("requestId", requestId);
    startTransition(async () => {
      setState(await openFixPrAction(state, formData));
    });
  }

  if (!githubConnected) {
    return (
      <p className="rounded-xl border border-line bg-surface px-4 py-3 text-sm text-muted">
        <Link href="/dashboard/settings" className="font-medium text-accent hover:underline">
          Connect GitHub
        </Link>{" "}
        in Settings to open these as a pull request instead of copying them by hand.
      </p>
    );
  }

  if (state.status === "opened") {
    return (
      <div className="flex flex-wrap items-center gap-4 rounded-xl border border-good/40 bg-surface px-4 py-3">
        <span className="text-sm font-medium text-good">
          Pull request #{state.prNumber} opened.
        </span>
        <a
          href={state.prUrl}
          target="_blank"
          rel="noreferrer"
          className="text-sm font-medium text-accent hover:underline"
        >
          View on GitHub ↗
        </a>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        type="button"
        onClick={open}
        disabled={isPending}
        className="inline-flex h-11 items-center justify-center rounded-full bg-accent px-6 font-sans text-[15px] font-semibold text-accent-ink transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-70"
      >
        {isPending ? "Opening PR…" : "Open a pull request with these fixes"}
      </button>
      {state.status === "error" && (
        <span role="alert" className="text-sm text-bad">
          {state.error}
        </span>
      )}
    </div>
  );
}
