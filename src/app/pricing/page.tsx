import type { Metadata } from "next";
import Link from "next/link";
import PricingTable from "@/components/PricingTable";
import { getCurrentUser } from "@/lib/auth";
import { PLANS } from "@/lib/billing/plans";
import { isBillingConfigured } from "@/lib/billing/stripe";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Pricing — WeBind Design",
  description:
    "Simple, honest pricing for AI visibility. Diagnose free, then fix and track from $19/mo — under every other AI-visibility tool.",
  // Pre-launch: keep the whole site out of search indexes (see root layout).
  robots: { index: false, follow: false, nocache: true },
};

const FAQ = [
  {
    q: "What counts as a “fix”?",
    a: "One grounded Fix Generator run: WeBind reads a real snapshot of your page, cites the exact evidence, and drafts a surgical change (meta, schema, structure) for you to review before anything ships. You always approve before it’s applied.",
  },
  {
    q: "Can I cancel anytime?",
    a: "Yes. Paid plans start with a 14-day trial and are month-to-month — cancel from billing settings and you keep access through the period you paid for.",
  },
  {
    q: "Why is this cheaper than the others?",
    a: "Most AI-visibility tools are pure dashboards priced at $79–$499/mo. WeBind runs lean and bundles diagnosis, fixing, and one-click apply — so we can charge a fraction and still do more.",
  },
];

export default async function PricingPage() {
  const [user, billingConfigured] = await Promise.all([
    getCurrentUser(),
    Promise.resolve(isBillingConfigured()),
  ]);

  return (
    <div className="flex min-h-full flex-col">
      {/* Nav — same wordmark + [scan] mark as the rest of the site. */}
      <header className="mx-auto flex w-full max-w-6xl flex-col items-center gap-4 px-6 py-6 sm:flex-row sm:justify-between">
        <Link href="/" className="flex items-baseline gap-2 whitespace-nowrap">
          <span className="font-display text-xl font-semibold tracking-tight text-ink">WeBind Design</span>
          <span className="font-mono text-[11px] tracking-[0.22em] text-accent" aria-hidden="true">
            [scan]
          </span>
        </Link>
        <nav className="flex items-center gap-5">
          <Link
            href="/methodology"
            className="whitespace-nowrap font-sans text-sm font-medium text-muted transition-colors hover:text-accent"
          >
            Methodology
          </Link>
          {user ? (
            <Link
              href="/dashboard"
              className="whitespace-nowrap rounded-full border border-line px-4 py-1.5 font-sans text-sm font-medium text-ink transition-colors hover:border-accent hover:text-accent"
            >
              Dashboard
            </Link>
          ) : (
            <Link
              href="/login"
              className="whitespace-nowrap rounded-full border border-line px-4 py-1.5 font-sans text-sm font-medium text-ink transition-colors hover:border-accent hover:text-accent"
            >
              Log in
            </Link>
          )}
        </nav>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-6 pb-24">
        <section className="mx-auto max-w-2xl pt-12 text-center sm:pt-16">
          <p className="reveal font-mono text-xs uppercase tracking-[0.24em] text-accent">
            <span aria-hidden="true">[ </span>
            Pricing
            <span aria-hidden="true"> ]</span>
          </p>
          <h1
            className="reveal mt-5 font-display text-[2.3rem] font-semibold leading-[1.05] tracking-tight text-ink sm:text-5xl"
            style={{ animationDelay: "60ms" }}
          >
            Diagnose free. Then{" "}
            <span className="relative whitespace-nowrap text-accent">
              <span className="relative z-10">fix</span>
              <span
                className="absolute inset-x-0 bottom-1 h-[0.4em] bg-accent-soft"
                aria-hidden="true"
              />
            </span>{" "}
            for less than everyone else.
          </h1>
          <p
            className="reveal mx-auto mt-5 max-w-xl text-[15px] leading-relaxed text-muted sm:text-base"
            style={{ animationDelay: "120ms" }}
          >
            Every AI-visibility tool tells you where you rank. WeBind also generates the
            evidence-grounded fixes and applies them — for a fraction of what the trackers charge.
          </p>
        </section>

        <div className="reveal mt-12" style={{ animationDelay: "180ms" }}>
          <PricingTable plans={PLANS} billingConfigured={billingConfigured} signedIn={Boolean(user)} />
        </div>

        <p className="mx-auto mt-6 max-w-xl text-center text-xs leading-relaxed text-muted">
          &ldquo;Unlimited&rdquo; allowances are subject to fair use. We reserve the right to limit,
          change, or suspend the number of reports and other usage on any plan — including the free
          tier — at any time. See{" "}
          <Link href="/terms" className="text-accent hover:underline">
            Terms
          </Link>
          .
        </p>

        <section className="mx-auto mt-16 max-w-2xl">
          <h2 className="text-center font-mono text-xs uppercase tracking-[0.2em] text-muted">
            <span aria-hidden="true">[ </span>Questions<span aria-hidden="true"> ]</span>
          </h2>
          <dl className="mt-6 space-y-3">
            {FAQ.map((item) => (
              <div key={item.q} className="rounded-xl border border-line bg-surface p-5">
                <dt className="font-sans text-sm font-semibold text-ink">{item.q}</dt>
                <dd className="mt-1.5 text-sm leading-relaxed text-muted">{item.a}</dd>
              </div>
            ))}
          </dl>
        </section>
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto flex w-full max-w-6xl flex-col items-center justify-between gap-3 px-6 py-6 text-center sm:flex-row sm:text-left">
          <span className="font-display text-sm font-semibold text-ink">WeBind Design</span>
          <nav className="flex flex-wrap items-center justify-center gap-x-5 gap-y-1 font-mono text-[11px] uppercase tracking-[0.16em] text-muted">
            <Link href="/methodology" className="hover:text-accent">
              Methodology
            </Link>
            <Link href="/bot" className="hover:text-accent">
              Bot
            </Link>
            <Link href="/privacy" className="hover:text-accent">
              Privacy
            </Link>
            <Link href="/terms" className="hover:text-accent">
              Terms
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
