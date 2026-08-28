import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import WordPressConnectionForm from "@/components/WordPressConnectionForm";
import GitHubConnectionForm from "@/components/GitHubConnectionForm";
import DeleteAccountForm from "@/components/DeleteAccountForm";
import { getCurrentUser, listSessions } from "@/lib/auth";
import { getWordPressConnectionStatus } from "@/lib/integrations/connections";
import { getGitHubConnectionStatus } from "@/lib/integrations/githubConnections";
import { summarizeUserAgent } from "@/lib/userAgent";
import { revokeOtherSessionsAction, revokeSessionAction } from "./actions";

export const metadata: Metadata = {
  title: "Settings — WeBind Design",
  robots: { index: false, follow: false, nocache: true },
};

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const [wordpress, github, sessions] = await Promise.all([
    getWordPressConnectionStatus(user.id),
    getGitHubConnectionStatus(user.id),
    listSessions(user.id),
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

        <section>
          <div className="flex items-baseline justify-between gap-4">
            <h2 className="font-display text-lg font-semibold text-ink">
              Sessions
            </h2>
            {sessions.length > 1 && (
              <form action={revokeOtherSessionsAction}>
                <button
                  type="submit"
                  className="font-mono text-xs uppercase tracking-[0.14em] text-muted hover:text-bad"
                >
                  Log out other devices
                </button>
              </form>
            )}
          </div>
          <p className="mt-1 text-sm text-muted">
            Everywhere you&apos;re currently signed in. Resetting your
            password signs all of these out automatically.
          </p>
          <ul className="mt-4 divide-y divide-line rounded-2xl border border-line bg-surface">
            {sessions.map((s) => {
              const isCurrent = s.id === user.sessionId;
              return (
                <li
                  key={s.id}
                  className="flex items-center justify-between gap-4 p-4"
                >
                  <div>
                    <p className="font-sans text-sm font-medium text-ink">
                      {summarizeUserAgent(s.userAgent)}
                      {isCurrent && (
                        <span className="ml-2 rounded-full border border-accent/40 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-accent">
                          This device
                        </span>
                      )}
                    </p>
                    <p className="mt-0.5 text-xs text-muted">
                      {s.ip ? `${s.ip} · ` : ""}
                      Signed in {s.createdAt.toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })}
                    </p>
                  </div>
                  {!isCurrent && (
                    <form action={revokeSessionAction}>
                      <input type="hidden" name="sessionId" value={s.id} />
                      <button
                        type="submit"
                        className="shrink-0 font-mono text-xs uppercase tracking-[0.14em] text-muted hover:text-bad"
                      >
                        Log out
                      </button>
                    </form>
                  )}
                </li>
              );
            })}
          </ul>
        </section>

        <section>
          <h2 className="font-display text-lg font-semibold text-ink">
            Danger zone
          </h2>
          <p className="mt-1 text-sm text-muted">
            Permanently delete your account and everything tied to it.
          </p>
          <div className="mt-4">
            <DeleteAccountForm />
          </div>
        </section>
      </div>
    </main>
  );
}
