import type { Metadata } from "next";
import SiteReportForm from "@/components/SiteReportForm";
import SiteHeader from "@/components/SiteHeader";

// Playwright (used by the crawler inside the server action) requires Node.
export const runtime = "nodejs";
// SiteHeader reads cookies/DB per request — never prerender.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Site scan — WeBind",
  description:
    "Assess the pages in a site's sitemap, or found by following its links: AI Readiness and Traditional Authority across the whole site, with the fixes that recur most.",
};

export default function SiteReportPage() {
  return (
    <div className="flex min-h-full flex-col">
      <SiteHeader />
      <main className="mx-auto w-full max-w-3xl flex-1 px-6 pb-14">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-accent">
            Whole-site scan
          </p>
          <h1 className="mt-2 font-display text-4xl font-semibold text-ink">
            Score every page on your site
          </h1>
          <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-muted">
            Enter your domain. WeBind finds your sitemap (and follows internal
            links for pages it misses), scores each page for AI Readiness and
            Traditional Authority, and surfaces the issues that show up across
            the whole site — so you fix the pattern, not one page.
          </p>
        </div>

        <div className="mt-8">
          <SiteReportForm />
        </div>
      </main>
    </div>
  );
}
