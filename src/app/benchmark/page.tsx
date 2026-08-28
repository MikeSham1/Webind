import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { isSerperConfigured } from "@/lib/benchmark/serper";
import BenchmarkForm from "@/components/BenchmarkForm";

export const metadata: Metadata = {
  title: "Competitive Benchmark — WeBind",
  robots: { index: false, follow: false, nocache: true },
};

// The crawler (in the server action) needs Node; auth reads cookies per request.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function BenchmarkPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const configured = isSerperConfigured();

  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-14">
      <div className="mb-10">
        <Link
          href="/dashboard"
          className="font-mono text-xs uppercase tracking-[0.16em] text-muted hover:text-accent"
        >
          ← Dashboard
        </Link>
        <p className="mt-6 font-mono text-xs uppercase tracking-[0.2em] text-muted">
          <span aria-hidden="true">[ </span>Competitive Benchmark<span aria-hidden="true"> ]</span>
        </p>
        <h1 className="mt-2 font-display text-4xl font-semibold text-ink">
          Grade against the pages actually winning
        </h1>
        <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-muted">
          Your readiness score grades you against our model of what AI engines
          reward. This grades you against the live field: we pull the search
          results for your query, crawl and score the pages ranking for it with
          the same engine, and show where you land as a competitive percentile —
          with a bootstrap confidence band, because a handful of rivals is a
          noisy sample.
        </p>
        {!configured && (
          <p className="mt-4 rounded-lg border border-dashed border-line bg-surface px-4 py-3 font-mono text-[11px] uppercase tracking-[0.14em] text-muted">
            <span aria-hidden="true">[ </span>
            Set SERPER_API_KEY to enable live benchmarking
            <span aria-hidden="true"> ]</span>
          </p>
        )}
      </div>
      <BenchmarkForm />
    </main>
  );
}
