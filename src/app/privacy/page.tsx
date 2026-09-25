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
        your site or repo without an explicit action from you.
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
        We send data to Anthropic (report narration, citation and visibility
        checks — only when an API key is configured), and to Resend
        (transactional email — only when configured). We don&apos;t sell
        data, and we don&apos;t use it for advertising.
      </P>

      <H2>Deleting your data</H2>
      <P>
        Delete your account from{" "}
        <Link href="/dashboard/settings" className="text-accent hover:underline">
          Settings
        </Link>
        . That permanently removes your user record, sessions, WordPress and
        GitHub connections, and publication records. Reports and content
        drafts you created are anonymized (kept, but no longer tied to your
        account) rather than deleted, the same as a report run while logged
        out — email us if you&apos;d like one of those removed outright. It
        does not un-publish content already live on your own WordPress site
        or already merged on GitHub; you control those directly.
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
