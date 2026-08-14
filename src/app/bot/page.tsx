import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "WebindBot — WeBind",
  description: "What WebindBot is, what it fetches, and how to block it.",
  // Pre-launch: keep the whole site out of search indexes (see root layout).
  robots: { index: false, follow: false, nocache: true },
};

function Code({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded bg-surface px-1.5 py-0.5 font-mono text-[13px] text-ink">
      {children}
    </code>
  );
}

export default function BotPage() {
  return (
    <main className="mx-auto w-full max-w-2xl px-6 py-14">
      <Link
        href="/"
        className="font-mono text-xs uppercase tracking-[0.16em] text-muted hover:text-accent"
      >
        ← WeBind
      </Link>

      <div className="mt-6">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted">
          Crawler transparency
        </p>
        <h1 className="mt-2 font-display text-3xl font-semibold text-ink">
          WebindBot
        </h1>
        <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-muted">
          WebindBot is the headless browser WeBind uses to fetch and render a
          page when someone runs an AI Readiness Report or a keyword
          visibility check. It identifies itself on the wire as:
        </p>
        <p className="mt-3">
          <Code>WebindBot/1.0 (+https://webind.design/bot; website authority analyzer)</Code>
        </p>
      </div>

      <section className="mt-10 space-y-3">
        <h2 className="font-display text-lg font-semibold text-ink">
          What it does
        </h2>
        <ul className="list-disc space-y-2 pl-5 text-[15px] leading-relaxed text-muted">
          <li>
            Fetches <strong className="text-ink">one page at a time</strong>,
            each time triggered directly by a person entering a URL into
            WeBind — never on a schedule, and never crawling a site&apos;s other
            pages or following links beyond that single page.
          </li>
          <li>
            Renders the page with headless Chromium, the same way a real
            visitor&apos;s browser would, so the report reflects what a page
            actually looks like after JavaScript runs.
          </li>
          <li>
            Also fetches <Code>/robots.txt</Code> and <Code>/llms.txt</Code>{" "}
            from the same site — not to decide whether it may proceed, but to
            score whether the site&apos;s own rules currently welcome or block
            named AI crawlers (GPTBot, ClaudeBot, PerplexityBot,
            Google-Extended).
          </li>
          <li>
            Every response body it reads is size-capped, and every request —
            including ones a redirect points to — is checked against a
            block-list of private, loopback, and cloud-metadata addresses
            before it is fetched.
          </li>
        </ul>
      </section>

      <section className="mt-10 space-y-3">
        <h2 className="font-display text-lg font-semibold text-ink">
          What it does not do
        </h2>
        <ul className="list-disc space-y-2 pl-5 text-[15px] leading-relaxed text-muted">
          <li>
            It does not currently check <Code>robots.txt</Code> before
            fetching the single page a visitor asked about. It is not an
            autonomous crawler working through a site on its own — it is
            closer to a person&apos;s browser fetching a page they asked to
            see, and blocking it would mean a site owner could not analyze
            their own homepage. If that reasoning does not fit your case,
            blocking it below is respected the same way any User-Agent block
            would be.
          </li>
          <li>
            It does not execute logins, submit forms, or interact with the
            page beyond loading it and letting client-side JavaScript run.
          </li>
          <li>
            It does not store your page&apos;s content beyond what the
            person who requested the report can see in their own account.
          </li>
        </ul>
      </section>

      <section className="mt-10 space-y-3">
        <h2 className="font-display text-lg font-semibold text-ink">
          Blocking WebindBot
        </h2>
        <p className="text-[15px] leading-relaxed text-muted">
          Deny it by User-Agent at your server or WAF, for example:
        </p>
        <pre className="overflow-x-auto rounded-xl border border-line bg-surface p-4 font-mono text-[13px] text-ink">
{`User-agent: WebindBot
Disallow: /`}
        </pre>
        <p className="text-[15px] leading-relaxed text-muted">
          A blocked fetch fails the report cleanly with an error, rather than
          silently working around the block.
        </p>
      </section>

      <section className="mt-10 space-y-3">
        <h2 className="font-display text-lg font-semibold text-ink">
          Questions
        </h2>
        <p className="text-[15px] leading-relaxed text-muted">
          Reach us at{" "}
          <a href="mailto:info@webind.design" className="text-accent hover:underline">
            info@webind.design
          </a>
          .
        </p>
      </section>
    </main>
  );
}
