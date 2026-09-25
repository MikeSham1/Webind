"use client";

import { useEffect } from "react";
import Link from "next/link";
import { logError } from "@/lib/log";

/**
 * The route-level error boundary.
 *
 * Without one, any thrown error in a page renders React's bare fallback — in
 * production a blank screen with "Application error: a client-side exception
 * has occurred", which tells the user nothing and offers no way forward. This
 * keeps them on the site, gives them a retry (most failures here are a
 * transient DB or model call), and logs the digest so the crash is findable in
 * Railway's logs.
 *
 * Deliberately does NOT render the message: it can carry query fragments or
 * upstream detail that shouldn't be shown to whoever hit the page.
 */
export default function Error({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  // Next 16 prop. reset() only clears the error state; unstable_retry()
  // re-fetches and re-renders, which is what these failures (a transient DB
  // or model call) actually need. The docs recommend it over reset.
  unstable_retry: () => void;
}) {
  useEffect(() => {
    logError("page.crash", { digest: error.digest, message: error.message });
  }, [error]);

  return (
    <div className="mx-auto flex min-h-full w-full max-w-2xl flex-col items-center justify-center px-6 py-24 text-center">
      <p className="font-sans text-sm font-medium text-accent">Something went wrong</p>
      <h1 className="mt-2 font-display text-4xl font-semibold tracking-tight text-ink sm:text-5xl">
        That didn&apos;t load
      </h1>
      <p className="mt-4 max-w-md text-[15px] leading-relaxed text-muted">
        The page hit an error on our side. Trying again usually works — nothing
        you saved has been lost.
      </p>
      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
        <button
          type="button"
          onClick={() => unstable_retry()}
          className="inline-flex h-11 items-center justify-center rounded-full bg-accent px-6 font-sans text-[15px] font-semibold text-accent-ink transition-colors hover:bg-accent-hover"
        >
          Try again
        </button>
        <Link
          href="/"
          className="inline-flex h-11 items-center justify-center rounded-full border border-line-strong px-6 font-sans text-[15px] font-medium text-ink transition-colors hover:border-accent hover:text-accent"
        >
          Back to start
        </Link>
      </div>
      {error.digest && (
        // The one detail worth showing: it's what support would ask for.
        <p className="mt-8 text-xs text-muted">
          Reference: <span className="font-medium text-ink">{error.digest}</span>
        </p>
      )}
    </div>
  );
}
