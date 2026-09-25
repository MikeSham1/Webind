import Link from "next/link";
import type { Metadata } from "next";
import SiteHeader from "@/components/SiteHeader";

export const metadata: Metadata = {
  title: "Page not found — WeBind Design",
  robots: { index: false, follow: false },
};

/**
 * A branded 404 with a way out.
 *
 * Next's built-in fallback is an unstyled "404: This page could not be found."
 * with no nav — a dead end that looks like the site broke rather than like a
 * mistyped URL. Every route that calls notFound() (a report or draft that
 * isn't yours, a stale link) lands here, so it needs to keep the header and
 * offer the two places people actually want.
 */
export default function NotFound() {
  return (
    <div className="flex min-h-full flex-col">
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col items-center justify-center px-6 py-24 text-center">
        <p className="font-sans text-sm font-medium text-accent">404</p>
        <h1 className="mt-2 font-display text-4xl font-semibold tracking-tight text-ink sm:text-5xl">
          We can&apos;t find that page
        </h1>
        <p className="mt-4 max-w-md text-[15px] leading-relaxed text-muted">
          The link may be out of date, or the report or draft you&apos;re after
          belongs to a different account.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/"
            className="inline-flex h-11 items-center justify-center rounded-full bg-accent px-6 font-sans text-[15px] font-semibold text-accent-ink transition-colors hover:bg-accent-hover"
          >
            Run a report
          </Link>
          <Link
            href="/dashboard"
            className="inline-flex h-11 items-center justify-center rounded-full border border-line-strong px-6 font-sans text-[15px] font-medium text-ink transition-colors hover:border-accent hover:text-accent"
          >
            Go to your dashboard
          </Link>
        </div>
      </main>
    </div>
  );
}
