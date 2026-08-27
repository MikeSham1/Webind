import type { Metadata } from "next";
import Link from "next/link";
import PricingTable from "@/components/PricingTable";
import { getCurrentUser } from "@/lib/auth";
import { PLANS } from "@/lib/billing/plans";
import { isBillingConfigured } from "@/lib/billing/stripe";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Pricing — WeBind",
  description:
    "Simple, honest pricing for AI visibility. Diagnose free, then fix and track from $19/mo — under every other AI-visibility tool.",
  // Pre-launch: keep the whole site out of search indexes (see root layout).
  robots: { index: false, follow: false, nocache: true },
};

export default async function PricingPage() {
  const [user, billingConfigured] = await Promise.all([
    getCurrentUser(),
    Promise.resolve(isBillingConfigured()),
  ]);

  return (
    <main className="mx-auto w-full max-w-4xl px-6 py-14">
      <Link
        href="/"
        className="font-mono text-xs uppercase tracking-[0.16em] text-muted hover:text-accent"
      >
        ← WeBind
      </Link>

      <div className="mt-6 text-center">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted">Pricing</p>
        <h1 className="mt-2 font-display text-3xl font-semibold text-ink">
          Diagnose free. Fix for less than everyone else.
        </h1>
        <p className="mx-auto mt-3 max-w-xl text-[15px] leading-relaxed text-muted">
          Every AI-visibility tool tells you where you rank. WeBind also generates the
          evidence-grounded fixes and applies them — for a fraction of what the trackers charge.
        </p>
      </div>

      <div className="mt-10">
        <PricingTable plans={PLANS} billingConfigured={billingConfigured} signedIn={Boolean(user)} />
      </div>

      <p className="mx-auto mt-6 max-w-xl text-center text-xs leading-relaxed text-muted">
        &ldquo;Unlimited&rdquo; allowances are subject to fair use. We reserve the
        right to limit, change, or suspend the number of reports and other usage
        on any plan — including the free tier — at any time. See{" "}
        <Link href="/terms" className="text-accent hover:underline">
          Terms
        </Link>
        .
      </p>

      <section className="mt-14 space-y-4">
        <h2 className="font-display text-lg font-semibold text-ink">Questions</h2>
        <dl className="space-y-3">
          <div className="rounded-xl border border-line bg-surface p-4">
            <dt className="font-sans text-sm font-semibold text-ink">
              What counts as a &ldquo;fix&rdquo;?
            </dt>
            <dd className="mt-1.5 text-sm leading-relaxed text-muted">
              One grounded Fix Generator run: WeBind reads a real snapshot of your page, cites the
              exact evidence, and drafts a surgical change (meta, schema, structure) for you to
              review before anything ships. You always approve before it&rsquo;s applied.
            </dd>
          </div>
          <div className="rounded-xl border border-line bg-surface p-4">
            <dt className="font-sans text-sm font-semibold text-ink">Can I cancel anytime?</dt>
            <dd className="mt-1.5 text-sm leading-relaxed text-muted">
              Yes. Paid plans start with a 14-day trial and are month-to-month — cancel from billing
              settings and you keep access through the period you paid for.
            </dd>
          </div>
          <div className="rounded-xl border border-line bg-surface p-4">
            <dt className="font-sans text-sm font-semibold text-ink">
              Why is this cheaper than the others?
            </dt>
            <dd className="mt-1.5 text-sm leading-relaxed text-muted">
              Most AI-visibility tools are pure dashboards priced at $79–$499/mo. WeBind runs lean
              and bundles diagnosis, fixing, and one-click apply — so we can charge a fraction and
              still do more.
            </dd>
          </div>
        </dl>
      </section>
    </main>
  );
}
