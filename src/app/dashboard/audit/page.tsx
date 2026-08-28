import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { listAuditLog } from "@/lib/audit";

export const metadata: Metadata = {
  title: "Audit log — WeBind Design",
  robots: { index: false, follow: false, nocache: true },
};

export const dynamic = "force-dynamic";

function fmtDateTime(d: Date | string): string {
  return new Date(d).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default async function AuditLogPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!user.isAdmin) redirect("/dashboard");

  const entries = await listAuditLog(200);

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-12">
      <Link
        href="/dashboard"
        className="font-mono text-xs uppercase tracking-[0.16em] text-muted hover:text-accent"
      >
        ← Dashboard
      </Link>

      <div className="mt-6">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted">
          Admin
        </p>
        <h1 className="mt-2 font-display text-3xl font-semibold text-ink">
          Audit log
        </h1>
        <p className="mt-3 max-w-lg text-[15px] leading-relaxed text-muted">
          Every write WeBind has made to a customer&apos;s WordPress site or
          GitHub repo — who, where, what changed, and whether it worked.
          Append-only.
        </p>
      </div>

      {entries.length === 0 ? (
        <div className="mt-8 rounded-2xl border border-dashed border-line bg-surface p-8 text-center">
          <p className="text-sm text-muted">No entries yet.</p>
        </div>
      ) : (
        <div className="mt-8 overflow-x-auto rounded-2xl border border-line">
          <table className="w-full text-left text-sm">
            <thead className="bg-surface font-mono text-xs uppercase tracking-wider text-muted">
              <tr>
                <th className="px-4 py-3">When</th>
                <th className="px-4 py-3">Action</th>
                <th className="px-4 py-3">Destination</th>
                <th className="px-4 py-3">Result</th>
                <th className="px-4 py-3">Detail</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id} className="border-t border-line align-top">
                  <td className="whitespace-nowrap px-4 py-3 text-muted">
                    {fmtDateTime(e.createdAt)}
                  </td>
                  <td className="px-4 py-3 font-medium text-ink">{e.action}</td>
                  <td className="max-w-[16rem] truncate px-4 py-3 text-muted" title={e.destination}>
                    {e.destination}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider ${
                        e.result === "success"
                          ? "border-good/40 text-good"
                          : "border-bad/40 text-bad"
                      }`}
                    >
                      {e.result}
                    </span>
                  </td>
                  <td className="max-w-[20rem] px-4 py-3 text-muted">
                    {e.error ?? "—"}
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
