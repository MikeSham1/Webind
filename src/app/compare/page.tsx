import type { Metadata } from "next";
import Link from "next/link";
import CompareForm from "@/components/CompareForm";
import SiteHeader from "@/components/SiteHeader";

// Playwright (used by the crawler inside the server action) requires Node.
export const runtime = "nodejs";
// SiteHeader reads cookies/DB per request — never prerender.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Compare — WeBind Design",
  description:
    "Run two sites through the same AI-readiness read and see who's ahead, signal by signal.",
};

export default function ComparePage() {
  return (
    <div className="flex min-h-full flex-col">
      <SiteHeader />

      <main className="mx-auto w-full max-w-6xl flex-1 px-6 pb-24">
        <section className="mx-auto max-w-2xl pt-16 text-center sm:pt-20">
          <p className="reveal font-mono text-xs uppercase tracking-[0.24em] text-accent">
            Read two sites the same way
          </p>
          <h1 className="reveal mt-5 font-display text-4xl font-semibold leading-[1.05] tracking-tight text-ink sm:text-5xl">
            See who&apos;s actually ahead.
          </h1>
          <p className="reveal mx-auto mt-6 max-w-xl text-lg leading-relaxed text-muted">
            Put your page next to a competitor&apos;s and run the exact same AI
            Readiness and Traditional Authority scoring on both, side by side.
          </p>
        </section>

        <div className="reveal mt-12">
          <CompareForm />
        </div>
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto flex w-full max-w-6xl flex-col items-center justify-between gap-3 px-6 py-6 text-center sm:flex-row sm:text-left">
          <span className="font-display text-sm font-semibold text-ink">WeBind Design</span>
          <nav className="flex flex-wrap items-center justify-center gap-x-5 gap-y-1 font-mono text-[11px] uppercase tracking-[0.16em] text-muted">
            <Link href="/methodology" className="hover:text-accent">
              Methodology
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
