import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import ReportResults from "@/components/ReportResults";
import FixGeneratorPanel from "@/components/FixGeneratorPanel";
import { getCurrentUser } from "@/lib/auth";
import { getReportById, getReportForUser } from "@/lib/leads";
import { getGitHubConnectionStatus } from "@/lib/integrations/githubConnections";
import { getPrForReport } from "@/lib/integrations/codeFixes";

export const metadata: Metadata = {
  title: "Report — WeBind Design",
  robots: { index: false, follow: false, nocache: true },
};

export const dynamic = "force-dynamic";

export default async function ReportDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const { id } = await params;
  const row = user.isAdmin ? await getReportById(id) : await getReportForUser(id, user.id);
  if (!row || !row.report) notFound();

  // Admins may inspect any saved report, including anonymous reports and reports
  // owned by another account. That is intentionally read-only: all mutation
  // actions (Fix Generator, GitHub PRs, review/deployment records) remain scoped
  // to the report owner. Do not render controls that the server will reject.
  const canManageReport = row.userId === user.id;

  const [githubConnected, pr] = canManageReport
    ? await Promise.all([
        getGitHubConnectionStatus(user.id).then((status) => status !== null),
        getPrForReport(row.id),
      ])
    : [false, null] as const;

  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-12">
      <Link
        href="/dashboard"
        className="font-mono text-xs uppercase tracking-[0.16em] text-muted hover:text-accent"
      >
        ← Dashboard
      </Link>
      <div className="mt-10">
        <ReportResults
          report={row.report}
          // requestId enables owner-only mutation controls inside ReportResults
          // (notably OpenPrBar). Admin read-only views must not expose them.
          requestId={canManageReport ? row.id : null}
          optimizations={row.optimizations ?? undefined}
          githubConnected={githubConnected}
          initialPr={pr ? { prUrl: pr.prUrl, prNumber: pr.prNumber } : null}
          // Persisted at the time the report ran — showing the same narrative
          // and (if unlocked) the same tailored suggestions the visitor saw
          // then, rather than an empty/generic state on revisit.
          narrative={row.narrative ?? undefined}
          narrativeIsAi={row.narrativeIsAi}
          suggestions={row.suggestions ?? undefined}
          suggestionsLocked={row.suggestionsLocked}
          pageExperience={row.pageExperience}
          scoreAudit={row.scoreAudit}
        />
      </div>
      <div className="mt-10">
        {canManageReport ? (
          <FixGeneratorPanel requestId={row.id} />
        ) : (
          <section className="scan-frame border border-line bg-surface p-6 sm:p-7">
            <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-accent">
              Fix Generator · read-only
            </p>
            <p className="mt-2 text-sm leading-relaxed text-muted">
              This report is not owned by the account you are signed in with, so owner-only fix generation is disabled. Run a new report while signed in to generate and review fixes.
            </p>
          </section>
        )}
      </div>
    </main>
  );
}
