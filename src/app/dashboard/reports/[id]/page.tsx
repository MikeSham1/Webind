import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import ReportResults from "@/components/ReportResults";
import { getCurrentUser } from "@/lib/auth";
import { getReportById, getReportForUser } from "@/lib/leads";

export const metadata: Metadata = {
  title: "Report — WeBind",
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

  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-12">
      <Link
        href="/dashboard"
        className="font-mono text-xs uppercase tracking-[0.16em] text-muted hover:text-accent"
      >
        ← Dashboard
      </Link>
      <div className="mt-10">
        <ReportResults report={row.report} requestId={row.id} />
      </div>
    </main>
  );
}
