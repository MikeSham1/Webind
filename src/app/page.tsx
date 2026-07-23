import Link from "next/link";
import ReportForm from "@/components/ReportForm";

// Playwright (used by the crawler inside the server action) requires Node.
export const runtime = "nodejs";

export default function Home() {
  return (
    <div className="flex min-h-full flex-col">
      {/* Nav */}
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-6">
        <Link href="/" className="flex items-baseline gap-2">
          <span className="font-display text-xl font-semibold tracking-tight text-ink">
            WeBind
          </span>
          <span className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted">
            Design
          </span>
        </Link>
        <nav className="flex items-center gap-5">
          <Link
            href="/studio"
            className="font-sans text-sm font-medium text-muted transition-colors hover:text-accent"
          >
            Content Studio
          </Link>
          <Link
            href="/dashboard"
            className="font-sans text-sm font-medium text-muted transition-colors hover:text-accent"
          >
            Dashboard
          </Link>
          <Link
            href="/login"
            className="rounded-full border border-line px-4 py-1.5 font-sans text-sm font-medium text-ink transition-colors hover:border-accent hover:text-accent"
          >
            Log in
          </Link>
        </nav>
      </header>

      {/* Hero + report */}
      <main className="mx-auto w-full max-w-6xl flex-1 px-6 pb-24">
        <section className="mx-auto max-w-3xl pt-16 text-center sm:pt-24">
          <p className="reveal font-mono text-xs uppercase tracking-[0.24em] text-accent">
            The new front page is an AI answer
          </p>
          <h1
            className="reveal mt-5 font-display text-[2.6rem] font-semibold leading-[1.05] tracking-tight text-ink sm:text-6xl"
            style={{ animationDelay: "60ms" }}
          >
            Find out if AI{" "}
            <span className="italic text-accent">recommends</span> your website.
          </h1>
          <p
            className="reveal mx-auto mt-6 max-w-xl text-lg leading-relaxed text-muted"
            style={{ animationDelay: "120ms" }}
          >
            ChatGPT, Perplexity, and Google now decide who gets discovered. Enter
            your URL for two authority scores — and the exact, prioritized fixes
            to climb.
          </p>

          <div className="reveal mt-10" style={{ animationDelay: "180ms" }}>
            <ReportForm />
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-line">
        <div className="mx-auto flex w-full max-w-6xl flex-col items-center justify-between gap-2 px-6 py-6 text-center sm:flex-row sm:text-left">
          <span className="font-display text-sm font-semibold text-ink">
            WeBind Design
          </span>
          <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted">
            Authority for the AI era
          </span>
        </div>
      </footer>
    </div>
  );
}
