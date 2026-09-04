import type { Metadata } from "next";
import Link from "next/link";
import SiteReportForm from "@/components/SiteReportForm";

// Playwright (used by the crawler inside the server action) requires Node.
export const runtime = "nodejs";

export const metadata: Metadata = {
  title: "Site scan — WeBind",
  description:
    "Assess every page in a site's sitemap: AI Readiness and Traditional Authority across the whole site, with the fixes that recur most.",
  robots: { index: false, follow: false, nocache: true },
};

export default function SiteReportPage() {
  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-14">
      <Link
        href="/"
        className="font-mono text-xs uppercase tracking-[0.16em] text-muted hover:text-accent"
      >
        ← Single-page report
      </Link>

      <div className="mt-6">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-accent">
          Whole-site scan
        </p>
        <h1 className="mt-2 font-display text-4xl font-semibold text-ink">
          Score every page in your sitemap
        </h1>
        <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-muted">
          Enter your domain. WeBind finds your sitemap, scores each page for AI
          Readiness and Traditional Authority, and surfaces the issues that show
          up across the whole site — so you fix the pattern, not one page.
        </p>
      </div>

      <div className="mt-8">
        <SiteReportForm />
      </div>
    </main>
  );
}
