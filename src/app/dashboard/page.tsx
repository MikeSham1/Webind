import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { logoutAction, resendVerificationEmailAction } from "@/app/account/actions";
import { getCurrentUser } from "@/lib/auth";
import { listAllDrafts, listDraftsForUser } from "@/lib/content/store";
import { listAllReports, listReportsForUser } from "@/lib/leads";

export const metadata: Metadata = {
  title: "Dashboard — WeBind",
  robots: { index: false, follow: false, nocache: true },
};

// Auth-gated + reads cookies/DB per request — never prerender.
export const dynamic = "force-dynamic";

function fmtDate(d: Date | string): string {
  return new Date(d).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

const STATUS_STYLE: Record<string, string> = {
  approved: "text-good",
  rejected: "text-bad",
  pending_review: "text-warn",
};

export default async function DashboardPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const isAdmin = user.isAdmin;

  const [reports, drafts] = await Promise.all([
    isAdmin ? listAllReports() : listReportsForUser(user.id),
    isAdmin ? listAllDrafts() : listDraftsForUser(user.id),
  ]);

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-12">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-line pb-6">
        <div>
          <div className="flex items-center gap-3">
            <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted">
              Dashboard
            </p>
            {isAdmin && (
              <span className="rounded-full border border-accent/40 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-accent">
                Admin
              </span>
            )}
          </div>
          <h1 className="mt-1 font-display text-3xl font-semibold text-ink">
            {isAdmin ? "Admin workspace" : "Your workspace"}
          </h1>
          <p className="mt-1 text-sm text-muted">{user.email}</p>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <Link
            href="/"
            className="whitespace-nowrap font-sans text-sm font-medium text-muted hover:text-accent"
          >
            New report
          </Link>
          <Link
            href="/visibility"
            className="whitespace-nowrap font-sans text-sm font-medium text-muted hover:text-accent"
          >
            Keyword Visibility
          </Link>
          <Link
            href="/studio"
            className="whitespace-nowrap font-sans text-sm font-medium text-muted hover:text-accent"
          >
            Content Studio
          </Link>
          <Link
            href="/dashboard/settings"
            className="whitespace-nowrap font-sans text-sm font-medium text-muted hover:text-accent"
          >
            Settings
          </Link>
          <form action={logoutAction}>
            <button
              type="submit"
              className="whitespace-nowrap rounded-full border border-line-strong px-4 py-1.5 font-sans text-sm font-medium text-ink hover:border-bad hover:text-bad"
            >
              Log out
            </button>
          </form>
        </div>
      </header>

      {!user.emailVerifiedAt && (
        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-warn/40 bg-surface px-5 py-4">
          <p className="text-sm text-ink">
            Verify your email ({user.email}) to secure your account.
          </p>
          <form action={resendVerificationEmailAction}>
            <button
              type="submit"
              className="whitespace-nowrap font-mono text-xs uppercase tracking-[0.14em] text-accent hover:underline"
            >
              Resend verification email
            </button>
          </form>
        </div>
      )}

      {/* Reports */}
      <section className="mt-10">
        <h2 className="font-display text-xl font-semibold text-ink">
          {isAdmin ? "All authority reports" : "Your authority reports"}
        </h2>
        {reports.length === 0 ? (
          <EmptyState
            text="No reports yet."
            cta={<Link href="/" className="text-accent hover:underline">Run one →</Link>}
          />
        ) : (
          <div className="mt-4 overflow-x-auto rounded-2xl border border-line">
            <table className="w-full text-left text-sm">
              <thead className="bg-surface font-mono text-xs uppercase tracking-wider text-muted">
                <tr>
                  <Th>Site</Th>
                  <Th>AI</Th>
                  <Th>Traditional</Th>
                  <Th>Lead email</Th>
                  <Th>Date</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {reports.map((r) => (
                  <tr key={r.id} className="border-t border-line">
                    <Td className="font-medium text-ink">{r.url}</Td>
                    <Td>{r.aiTotal ?? "—"}</Td>
                    <Td>{r.traditionalTotal ?? "—"}</Td>
                    <Td className="text-muted">{r.email ?? "—"}</Td>
                    <Td className="text-muted">{fmtDate(r.createdAt)}</Td>
                    <Td>
                      <Link
                        href={`/dashboard/reports/${r.id}`}
                        className="font-medium text-accent hover:underline"
                      >
                        Open
                      </Link>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Content drafts */}
      <section className="mt-12">
        <h2 className="font-display text-xl font-semibold text-ink">
          {isAdmin ? "All content drafts" : "Your content drafts"}
        </h2>
        {drafts.length === 0 ? (
          <EmptyState
            text="No drafts yet."
            cta={<Link href="/studio" className="text-accent hover:underline">Open the Content Studio →</Link>}
          />
        ) : (
          <div className="mt-4 overflow-x-auto rounded-2xl border border-line">
            <table className="w-full text-left text-sm">
              <thead className="bg-surface font-mono text-xs uppercase tracking-wider text-muted">
                <tr>
                  <Th>Topic</Th>
                  <Th>Status</Th>
                  <Th>Date</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {drafts.map((d) => (
                  <tr key={d.id} className="border-t border-line">
                    <Td className="font-medium text-ink">{d.topic}</Td>
                    <Td className={`font-medium ${STATUS_STYLE[d.status] ?? "text-muted"}`}>
                      {d.status.replace("_", " ")}
                    </Td>
                    <Td className="text-muted">{fmtDate(d.createdAt)}</Td>
                    <Td>
                      <Link
                        href={`/dashboard/drafts/${d.id}`}
                        className="font-medium text-accent hover:underline"
                      >
                        Open
                      </Link>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}

function Th({ children }: { children?: React.ReactNode }) {
  return <th className="px-4 py-3">{children}</th>;
}

function Td({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <td className={`px-4 py-3 ${className}`}>{children}</td>;
}

function EmptyState({ text, cta }: { text: string; cta: React.ReactNode }) {
  return (
    <div className="mt-4 rounded-2xl border border-dashed border-line bg-surface p-8 text-center">
      <p className="text-sm text-muted">{text}</p>
      <p className="mt-2 text-sm">{cta}</p>
    </div>
  );
}
