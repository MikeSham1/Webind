import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy — WeBind Design",
  description:
    "What WeBind Design stores about you and the sites you scan, why each piece is kept, which third parties process it, and how to delete your account and its data.",
};

function H2({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mt-8 font-display text-lg font-semibold text-ink">
      {children}
    </h2>
  );
}

function P({ children }: { children: React.ReactNode }) {
  return <p className="mt-2 text-[15px] leading-relaxed text-muted">{children}</p>;
}

export default function PrivacyPage() {
  return (
    <main className="mx-auto w-full max-w-2xl px-6 py-14">
      <Link
        href="/"
        className="font-mono text-xs uppercase tracking-[0.16em] text-muted hover:text-accent"
      >
        ← WeBind Design
      </Link>

      <div className="mt-6">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted">
          Privacy
        </p>
        <h1 className="mt-2 font-display text-3xl font-semibold text-ink">
          What we store, and why
        </h1>
        <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-muted">
          This page describes what the product actually does, in plain
          language. It is not legal advice and is not a substitute for
          terms reviewed by a lawyer for your jurisdiction — if you need
          that, get one.
        </p>
      </div>

      <H2>Free reports</H2>
      <P>
        When you run a report, we store the URL, the page data our crawler
        fetched, the resulting scores, and — if you choose to leave it — an
        email address. If you were logged in, the report is tied to your
        account; otherwise it&apos;s anonymous and only reachable by whoever
        has the link.
      </P>

      <H2>Accounts</H2>
      <P>
        We store your email and a salted, scrypt-hashed password — never the
        password itself. Sessions are a random token whose SHA-256 hash we
        store, plus the browser and IP address that created it, so you can
        recognize your own sessions in Settings and revoke ones you don&apos;t.
        Password-reset and email-verification links are single-use tokens
        that expire and are invalidated the moment they&apos;re used.
      </P>

      <H2>WordPress and GitHub connections</H2>
      <P>
        If you connect WordPress or GitHub, the credential (a WordPress
        Application Password or a GitHub personal access token — never your
        main account password) is encrypted at rest with AES-256-GCM before
        it&apos;s stored. Every write we make on your behalf — a WordPress
        draft, a publish, a rollback, a pull request — is logged in an
        append-only audit trail: who did it, where, what changed, and
        whether it worked. Admins can review that trail; nothing in it is
        ever edited or deleted by the app.
      </P>

      <H2>Content drafts</H2>
      <P>
        Content Studio drafts (topic, generated title and body, and the
        inputs you gave it) are stored so you can come back to them, edit
        them, and publish when you&apos;re ready. Nothing is published to
        your site or repo without an explicit action from you. A draft you
        approve, and your edited final if you changed it, may also be used to
        improve the writer model — never a rejected or unreviewed one.
      </P>

      <H2>Keyword Visibility</H2>
      <P>
        A visibility check sends your keywords to the configured AI
        provider(s) as a live query — without naming your brand in the
        prompt, so the answer isn&apos;t primed toward you — and we store
        the resulting verdicts. We don&apos;t control what the AI provider
        itself retains on their end; check their policy if that matters to
        you.
      </P>

      <H2>Third parties</H2>
      <P>
        We send data to: <strong className="font-semibold text-ink">Google
        (Gemini)</strong>, the primary model behind reports, Content Studio
        drafts and planning, and the fabrication/originality checks —
        whenever a Gemini key is configured, which is the normal case;{" "}
        <strong className="font-semibold text-ink">Google Vertex AI</strong>,
        only if a tuned model endpoint is separately configured for the
        content writer;{" "}
        <strong className="font-semibold text-ink">Anthropic</strong>{" "}
        (Claude-based citation checks and the Claude option in Keyword
        Visibility probes — only when an Anthropic key is configured; report
        narration always uses Gemini, never Claude);{" "}
        <strong className="font-semibold text-ink">Google PageSpeed
        Insights</strong>, sent the page URL to fetch real-user Core Web
        Vitals; <strong className="font-semibold text-ink">Serper</strong>,
        for the competitive benchmark&apos;s search results — only when
        configured; <strong className="font-semibold text-ink">Stripe</strong>,
        for checkout and billing, whenever a paid plan is purchased or
        managed; and <strong className="font-semibold text-ink">Resend</strong>{" "}
        (transactional email — only when configured). OpenAI, Perplexity, and
        a generic search-API slot exist in the code as visibility-check
        options but send nothing anywhere unless you independently configure
        a key for them. We don&apos;t sell data, and we don&apos;t use it for
        advertising.
      </P>

      <H2>Deleting your data</H2>
      <P>
        Delete your account from{" "}
        <Link href="/dashboard/settings" className="text-accent hover:underline">
          Settings
        </Link>
        . That permanently removes your user record, sessions, WordPress and
        GitHub connections, and publication records, and cancels any active
        subscription. Reports and content drafts you created are anonymized
        (userId cleared, and any email you left on a report is cleared too)
        rather than deleted, the same as a report run while logged out —
        email us if you&apos;d like one removed outright. Anonymizing a row
        doesn&apos;t redact free-text content itself: if a report&apos;s URL,
        or a draft&apos;s topic/brief/body, includes your name, company, or
        other identifying details you typed in, that text is not
        automatically scrubbed — request removal by email if that matters to
        you. Account deletion also does not un-publish content already live
        on your own WordPress site or already merged on GitHub; you control
        those directly.
      </P>

      <H2>Questions</H2>
      <P>
        Reach us at{" "}
        <a href="mailto:info@webind.design" className="text-accent hover:underline">
          info@webind.design
        </a>
        .
      </P>
    </main>
  );
}
