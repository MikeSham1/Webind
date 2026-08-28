import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Terms — WeBind Design",
  description: "The rules for using WeBind.",
  // Pre-launch: keep the whole site out of search indexes (see root layout).
  robots: { index: false, follow: false, nocache: true },
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

export default function TermsPage() {
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
          Terms
        </p>
        <h1 className="mt-2 font-display text-3xl font-semibold text-ink">
          The rules for using WeBind
        </h1>
        <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-muted">
          Plain-language terms describing how the product actually works.
          This is not legal advice and is not a substitute for terms drafted
          or reviewed by a lawyer for your jurisdiction.
        </p>
      </div>

      <H2>What you&apos;re getting</H2>
      <P>
        WeBind analyzes a URL you provide and produces AI Readiness and
        Traditional Authority scores, a plain-English explanation, and
        prioritized fixes. See{" "}
        <Link href="/methodology" className="text-accent hover:underline">
          Methodology
        </Link>{" "}
        for exactly what is and isn&apos;t measured — including that the free
        report is a heuristic assessment of the page itself, not a live
        check of whether any AI model currently recommends you.
      </P>

      <H2>Usage limits</H2>
      <P>
        Reports, visibility checks, and fixes may be rate-limited, quota-limited,
        or otherwise capped, and we reserve the right to limit, change, or
        suspend the number of reports (or any other usage) available on any plan,
        including the free tier, at any time and without notice. &ldquo;Unlimited&rdquo;
        allowances are subject to fair use and may be limited to prevent abuse or
        protect the service.
      </P>

      <H2>Only analyze what you&apos;re allowed to</H2>
      <P>
        Only submit a URL you own or otherwise have permission to have
        analyzed. Our crawler fetches the page you submit, on your request,
        the same way a browser would; it does not attempt to bypass access
        controls, and it respects a User-Agent-based block on{" "}
        <Link href="/bot" className="text-accent hover:underline">
          WebindBot
        </Link>
        .
      </P>

      <H2>Publishing on your behalf</H2>
      <P>
        If you connect WordPress or GitHub, WeBind only writes when you take
        an explicit action — creating a draft is never the same as
        publishing it live, and going live requires a separate confirmation.
        You are responsible for reviewing content before it goes live and for
        the credentials you grant us (we recommend a least-privilege
        WordPress account and a scoped GitHub token, not an admin account or
        a token with broad access).
      </P>

      <H2>No guarantee of results</H2>
      <P>
        Scores and recommendations are our best current assessment based on
        published research, not a guarantee that any AI model or search
        engine will rank or cite your site any particular way.
      </P>

      <H2>Acceptable use</H2>
      <P>
        Don&apos;t use WeBind to attack, overload, or gain unauthorized
        access to any system, including our own — including attempting to
        route our crawler at internal or private network addresses. Don&apos;t
        abuse the free report or visibility check to scrape or enumerate
        other people&apos;s sites at volume; both are rate-limited, and we may
        further limit or suspend access that looks abusive.
      </P>

      <H2>Changes</H2>
      <P>
        We may update these terms and the product as it evolves. Material
        changes will be reflected on this page.
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
