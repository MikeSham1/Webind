import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import WordPressConnectionForm from "@/components/WordPressConnectionForm";
import GitHubConnectionForm from "@/components/GitHubConnectionForm";
import { getCurrentUser } from "@/lib/auth";
import { getWordPressConnectionStatus } from "@/lib/integrations/connections";
import { getGitHubConnectionStatus } from "@/lib/integrations/githubConnections";

export const metadata: Metadata = {
  title: "Settings — WeBind",
  robots: { index: false, follow: false, nocache: true },
};

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const [wordpress, github] = await Promise.all([
    getWordPressConnectionStatus(user.id),
    getGitHubConnectionStatus(user.id),
  ]);

  return (
    <main className="mx-auto w-full max-w-2xl px-6 py-12">
      <Link
        href="/dashboard"
        className="font-mono text-xs uppercase tracking-[0.16em] text-muted hover:text-accent"
      >
        ← Dashboard
      </Link>

      <div className="mt-6">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted">
          Settings
        </p>
        <h1 className="mt-2 font-display text-3xl font-semibold text-ink">
          Connections
        </h1>
        <p className="mt-3 max-w-lg text-[15px] leading-relaxed text-muted">
          Connect your sites so approved fixes can be applied in one click,
          instead of copying them by hand.
        </p>
      </div>

      <div className="mt-8 space-y-8">
        <section>
          <h2 className="font-display text-lg font-semibold text-ink">
            WordPress
          </h2>
          <p className="mt-1 text-sm text-muted">
            Publish approved Content Studio drafts as pages, with a roll-back
            if you change your mind.
          </p>
          <div className="mt-4">
            <WordPressConnectionForm connection={wordpress} />
          </div>
        </section>

        <section>
          <h2 className="font-display text-lg font-semibold text-ink">
            GitHub
          </h2>
          <p className="mt-1 text-sm text-muted">
            Open a pull request with a report&apos;s ready-to-apply fixes
            (llms.txt, robots.txt) instead of copying them by hand.
          </p>
          <div className="mt-4">
            <GitHubConnectionForm connection={github} />
          </div>
        </section>
      </div>
    </main>
  );
}
