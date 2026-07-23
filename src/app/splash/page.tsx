import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "WeBind Design — Private preview",
  robots: { index: false, follow: false, nocache: true },
};

export default async function SplashPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <main className="flex min-h-full flex-1 items-center justify-center bg-paper px-6 py-16 text-ink">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted">
            Private preview
          </p>
          <h1 className="mt-3 font-display text-3xl font-semibold">
            WeBind <span className="text-accent">Design</span>
          </h1>
          <p className="mt-2 text-sm text-muted">
            This site isn&apos;t public yet. Enter the access password to
            continue.
          </p>
        </div>

        <form
          method="post"
          action="/api/login"
          className="rounded-2xl border border-line bg-surface p-6 shadow-sm"
        >
          <label
            htmlFor="password"
            className="block text-sm font-medium text-ink"
          >
            Access password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            autoFocus
            required
            aria-invalid={error ? "true" : undefined}
            aria-describedby={error ? "pw-error" : undefined}
            className="mt-2 w-full rounded-lg border border-line-strong bg-paper px-3 py-2.5 text-ink outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent-soft"
          />

          {error ? (
            <p id="pw-error" role="alert" className="mt-3 text-sm text-bad">
              Incorrect password. Please try again.
            </p>
          ) : null}

          <button
            type="submit"
            className="mt-5 w-full rounded-lg bg-accent px-4 py-2.5 font-medium text-accent-ink transition-colors hover:bg-accent-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            Enter
          </button>
        </form>

        <p className="mt-6 text-center font-mono text-xs text-muted">
          WeBindDesign.com
        </p>
      </div>
    </main>
  );
}
