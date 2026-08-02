import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import DraftView from "@/components/DraftView";
import { getCurrentUser } from "@/lib/auth";
import { getDraftById, getDraftForUser } from "@/lib/content/store";
import { getWordPressConnectionStatus } from "@/lib/integrations/connections";
import { getPublicationForDraft } from "@/lib/integrations/publications";
import type { ContentDraft, GateReport } from "@/lib/content/types";

export const metadata: Metadata = {
  title: "Draft — WeBind",
  robots: { index: false, follow: false, nocache: true },
};

export const dynamic = "force-dynamic";

const EMPTY_GATES: GateReport = { results: [], blocked: false };

const STATUS_STYLE: Record<string, string> = {
  approved: "border-good/40 text-good",
  rejected: "border-bad/40 text-bad",
  pending_review: "border-warn/40 text-warn",
};

export default async function DraftDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const { id } = await params;
  const row = user.isAdmin
    ? await getDraftById(id)
    : await getDraftForUser(id, user.id);
  if (!row) notFound();

  const draft: ContentDraft = {
    title: row.title ?? row.topic,
    markdown: row.markdown ?? "",
    gates: row.gates ?? EMPTY_GATES,
  };

  // WordPress connection and any publish record belong to the draft's owner,
  // not necessarily the viewer — an admin reviewing someone else's draft must
  // see (and publish to) that owner's site, never their own.
  const [wordPressConnected, publication] = await Promise.all([
    row.userId
      ? getWordPressConnectionStatus(row.userId).then((status) => status !== null)
      : Promise.resolve(false),
    getPublicationForDraft(row.id),
  ]);

  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-12">
      <div className="mb-8 flex flex-wrap items-center justify-between gap-3">
        <Link
          href="/dashboard"
          className="font-mono text-xs uppercase tracking-[0.16em] text-muted hover:text-accent"
        >
          ← Dashboard
        </Link>
        <span
          className={`rounded-full border px-3 py-1 font-mono text-[10px] uppercase tracking-wider ${
            STATUS_STYLE[row.status] ?? "border-line text-muted"
          }`}
        >
          {row.status.replace("_", " ")}
        </span>
      </div>

      <DraftView
        draft={draft}
        draftId={row.id}
        initialStatus={row.status}
        wordPressConnected={wordPressConnected}
        initialPublication={
          publication
            ? { viewUrl: publication.wpViewUrl, editUrl: publication.wpEditUrl, status: publication.status }
            : null
        }
      />
    </main>
  );
}
