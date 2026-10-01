import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { listAllDrafts, listDraftsForUser } from "@/lib/content/store";
import { getPlannerConversation } from "@/lib/content/planner-store";
import { resolveActiveSite } from "@/lib/sites/store";
import { listAllReports, listReportsForUser } from "@/lib/leads";
import { getWordPressConnectionStatus } from "@/lib/integrations/connections";
import ResendVerificationButton from "@/components/ResendVerificationButton";
import SiteContextBar from "@/components/SiteContextBar";
import SiteHeader from "@/components/SiteHeader";
import SiteInsights from "@/components/SiteInsights";
import StudioWorkspace from "@/components/StudioWorkspace";

export const metadata: Metadata = {
  title: "Dashboard — WeBind Design",
  robots: { index: false, follow: false, nocache: true },
};

// Auth-gated + reads cookies/DB per request — never prerender.
export const dynamic = "force-dynamic";

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

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

  // The embedded studio's planner conversation is scoped per-site — resolve
  // it once up front so the dashboard and /studio always agree on which
  // conversation "the planner" currently means.
  const activeSite = await resolveActiveSite(user.id);
  const [reports, drafts, wpConnection, plannerMessages] = await Promise.all([
    isAdmin ? listAllReports() : listReportsForUser(user.id),
    isAdmin ? listAllDrafts() : listDraftsForUser(user.id),
    getWordPressConnectionStatus(user.id),
    getPlannerConversation(user.id, activeSite?.id ?? null),
  ]);
  const wordPressConnected = wpConnection !== null;

  return (
    <div className="flex min-h-full flex-col">
      <SiteHeader />
      <main className="mx-auto w-full max-w-5xl flex-1 px-6 pb-12">
      <div className="flex flex-wrap items-center gap-3 border-b border-line pb-6">
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

      {!user.emailVerifiedAt && (
        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-warn/40 bg-surface px-5 py-4">
          <p className="text-sm text-ink">
            Verify your email ({user.email}) to secure your account.
          </p>
          <ResendVerificationButton />
        </div>
      )}

      {/* Which site everything below is about. Same bar as the studio, on
          purpose: the active site scopes the insights AND the AI's idea of
          "my site", so it sits above both rather than next to only one. */}
      <div className="mt-8">
        <SiteContextBar userId={user.id} />
      </div>

      {/* 1 — Key insights about the user's site: the question the dashboard
          exists to answer, so it goes above everything else. */}
      <div className="mt-6">
        <SiteInsights userId={user.id} />
      </div>

      {/* 2 — Content Studio, directly beneath the insights that motivate it:
          you read what the site needs, then write it without changing pages. */}
      <section className="mt-10">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="font-display text-xl font-semibold text-ink">Content Studio</h2>
          <Link
            href="/studio"
            className="font-sans text-sm font-medium text-accent hover:underline"
          >
            Open full studio →
          </Link>
        </div>
        <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted">
          Plan a page with AI, turn the conversation into a grounded brief, and
          publish the approved draft to your site.
        </p>
        <div className="mt-5">
          <StudioWorkspace
            wordPressConnected={wordPressConnected}
            wordPressSiteUrl={wpConnection?.siteUrl ?? null}
            initialPlannerMessages={plannerMessages}
          />
        </div>
      </section>

      {/* Reports */}
      <section className="mt-14">
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
                      <div className="flex items-center gap-4">
                        <Link
                          href={`/dashboard/reports/${r.id}`}
                          className="font-medium text-accent hover:underline"
                        >
                          Open
                        </Link>
                        {!isAdmin && (
                          <Link
                            href={`/dashboard/history/${encodeURIComponent(hostOf(r.url))}`}
                            className="font-medium text-muted hover:text-accent hover:underline"
                          >
                            Trend
                          </Link>
                        )}
                      </div>
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
    </div>
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
