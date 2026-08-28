import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { listReportsForUserHost } from "@/lib/leads";
import TrendChart from "@/components/TrendChart";

export const metadata: Metadata = {
  title: "Score history — WeBind Design",
  robots: { index: false, follow: false, nocache: true },
};

export const dynamic = "force-dynamic";

function fmtDate(d: Date | string): string {
  return new Date(d).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function fmtDelta(first: number | null, last: number | null): string | null {
  if (first === null || last === null) return null;
  const diff = last - first;
  if (diff === 0) return "No change";
  return diff > 0 ? `+${diff} since first run` : `${diff} since first run`;
}

export default async function HostHistoryPage({
  params,
}: {
  params: Promise<{ host: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const { host: rawHost } = await params;
  const host = decodeURIComponent(rawHost);
  const runs = await listReportsForUserHost(user.id, host);

  const aiDelta = fmtDelta(
    runs[0]?.aiTotal ?? null,
    runs[runs.length - 1]?.aiTotal ?? null,
  );

  return (
    <main className="mx-auto w-full max-w-4xl px-6 py-12">
      <Link
        href="/dashboard"
        className="font-mono text-xs uppercase tracking-[0.16em] text-muted hover:text-accent"
      >
        ← Dashboard
      </Link>

      <header className="mt-8 border-b border-line pb-6">
        <p className="font-mono text-xs uppercase tracking-[0.22em] text-accent">
          <span aria-hidden="true">[ </span>
          Score history
          <span aria-hidden="true"> ]</span>
        </p>
        <h1 className="mt-2 font-display text-3xl font-semibold text-ink">{host}</h1>
        <p className="mt-2 text-sm text-muted">
          {runs.length} report{runs.length === 1 ? "" : "s"} run against this site
          {aiDelta ? ` · ${aiDelta} (AI Readiness)` : ""}
        </p>
      </header>

      {runs.length < 2 ? (
        <div className="mt-8 border border-dashed border-line bg-surface p-8 text-center">
          <p className="text-sm text-muted">
            Run this URL again from the homepage to start tracking how it moves
            over time — a trend needs at least two runs.
          </p>
          <p className="mt-3">
            <Link href="/" className="font-medium text-accent hover:underline">
              Run a new report →
            </Link>
          </p>
        </div>
      ) : (
        <div className="mt-8">
          <TrendChart
            points={runs.map((r) => ({
              date: r.createdAt,
              aiTotal: r.aiTotal,
              traditionalTotal: r.traditionalTotal,
            }))}
          />
        </div>
      )}

      {runs.length > 0 && (
        <div className="mt-10 overflow-x-auto border border-line">
          <table className="w-full text-left text-sm">
            <thead className="bg-surface font-mono text-xs uppercase tracking-wider text-muted">
              <tr>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">AI Readiness</th>
                <th className="px-4 py-3">Traditional Authority</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {[...runs].reverse().map((r) => (
                <tr key={r.id} className="border-t border-line">
                  <td className="px-4 py-3 text-muted">{fmtDate(r.createdAt)}</td>
                  <td className="px-4 py-3 font-medium text-ink">{r.aiTotal ?? "—"}</td>
                  <td className="px-4 py-3 font-medium text-ink">
                    {r.traditionalTotal ?? "—"}
                  </td>
                  <td className="px-4 py-3">
                    <Link
                      href={`/dashboard/reports/${r.id}`}
                      className="font-medium text-accent hover:underline"
                    >
                      Open
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
