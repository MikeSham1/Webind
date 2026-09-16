import Link from "next/link";
import ReportForm from "@/components/ReportForm";
import PricingTable from "@/components/PricingTable";
import SiteHeader from "@/components/SiteHeader";
import { PLANS } from "@/lib/billing/plans";
import { isBillingConfigured, stripeMode } from "@/lib/billing/stripe";
import { getCurrentUser } from "@/lib/auth";

// Playwright (used by the crawler inside the server action) requires Node.
export const runtime = "nodejs";
// Reads cookies/DB per request (nav login state, pricing personalization) —
// never prerender, or a build-time bake (e.g. no DATABASE_URL at build time)
// would serve one static, logged-out-looking page to every visitor forever.
export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await getCurrentUser();
  return (
    <div className="flex min-h-full flex-col">
      <SiteHeader />

      {/* Hero + report */}
      <main className="mx-auto w-full max-w-6xl flex-1 px-6 pb-24">
        <section className="mx-auto max-w-3xl pt-16 text-center sm:pt-24">
          <p className="reveal font-sans text-sm text-muted">
            The new front page is an AI answer
          </p>
          <h1
            className="reveal mt-5 font-display text-[2.6rem] font-semibold leading-[1.05] tracking-tight text-ink sm:text-6xl"
            style={{ animationDelay: "60ms" }}
          >
            Find out if your site is built for AI to{" "}
            <span className="relative whitespace-nowrap text-accent">
              <span className="relative z-10">recommend</span>
              <span
                className="absolute inset-x-0 bottom-1 h-[0.4em] bg-accent-soft"
                aria-hidden="true"
              />
            </span>
            .
          </h1>
          <p
            className="reveal mx-auto mt-6 max-w-xl text-lg leading-relaxed text-muted"
            style={{ animationDelay: "120ms" }}
          >
            ChatGPT, Perplexity, and Google now decide who gets discovered. Enter
            your URL for two AI-readiness scores — based on the structural and
            content signals AI answer engines actually cite — and the exact,
            prioritized fixes to climb.
          </p>

          <div className="reveal mt-10" style={{ animationDelay: "180ms" }}>
            <ReportForm />
          </div>

          <p
            className="reveal mt-6 text-sm text-muted"
            style={{ animationDelay: "220ms" }}
          >
            Got more than one page?{" "}
            <Link href="/site-report" className="font-medium text-accent hover:underline">
              Scan your whole sitemap →
            </Link>
          </p>
          <p
            className="reveal mt-2 text-sm text-muted"
            style={{ animationDelay: "260ms" }}
          >
            Want changes made for you?{" "}
            <Link href="/studio" className="font-medium text-accent hover:underline">
              Talk it through with AI in Content Studio →
            </Link>
          </p>
        </section>

        {/* Pricing — below the analyzer, so a visitor who just ran a report can
            convert without leaving the page. */}
        <section id="pricing" className="mx-auto mt-28 max-w-5xl scroll-mt-24">
          <div className="text-center">
            <p className="font-mono text-xs uppercase tracking-[0.24em] text-accent">
              <span aria-hidden="true">[ </span>
              Pricing
              <span aria-hidden="true"> ]</span>
            </p>
            <h2 className="mt-4 font-display text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
              Diagnose free. Fix for less than everyone else.
            </h2>
            <p className="mx-auto mt-3 max-w-xl text-[15px] leading-relaxed text-muted">
              Every AI-visibility tool tells you where you rank. WeBind Design also
              generates the evidence-grounded fixes and applies them — for a fraction
              of what the trackers charge.
            </p>
          </div>

          <div className="mt-10">
            <PricingTable
              plans={PLANS}
              billingConfigured={isBillingConfigured()}
              signedIn={Boolean(user)}
              testMode={stripeMode() === "test"}
            />
          </div>

          <p className="mt-6 text-center font-mono text-[11px] uppercase tracking-[0.16em] text-muted">
            <Link href="/pricing" className="hover:text-accent">
              Full plan details &amp; FAQ →
            </Link>
          </p>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-line">
        <div className="mx-auto flex w-full max-w-6xl flex-col items-center justify-between gap-3 px-6 py-6 text-center sm:flex-row sm:text-left">
          <span className="font-display text-sm font-semibold text-ink">
            WeBind Design
          </span>
          <nav className="flex flex-wrap items-center justify-center gap-x-5 gap-y-1 font-mono text-[11px] uppercase tracking-[0.16em] text-muted">
            <Link href="/pricing" className="hover:text-accent">
              Pricing
            </Link>
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
