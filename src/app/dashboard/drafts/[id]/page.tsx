import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import DraftView from "@/components/DraftView";
import type { PublicationSnapshot } from "@/components/PublishBar";
import { getCurrentUser } from "@/lib/auth";
import { currentDraftMarkdown, getDraftById, getDraftForUser } from "@/lib/content/store";
import { getWordPressConnectionStatus } from "@/lib/integrations/connections";
import { buildPreviewUrl } from "@/lib/integrations/wordpress";
import { getPublicationForDraft } from "@/lib/integrations/publications";
import type { ContentDraft, GateReport } from "@/lib/content/types";
import type { PublicationRow } from "@/lib/db/schema";

export const metadata: Metadata = {
  title: "Draft — WeBind Design",
  robots: { index: false, follow: false, nocache: true },
};

export const dynamic = "force-dynamic";

const EMPTY_GATES: GateReport = { results: [], blocked: false };

const STATUS_STYLE: Record<string, string> = {
  approved: "border-good/40 text-good",
  rejected: "border-bad/40 text-bad",
  pending_review: "border-warn/40 text-warn",
};

/**
 * Turn a raw publication row into what PublishBar needs to know in advance.
 * `pending`/`failed` rows have nothing meaningful to show yet — PublishBar
 * starts those fresh from its "Publish to WordPress" state, which is correct:
 * a `failed` row just means the last attempt didn't work, not that anything
 * exists on WordPress to show.
 */
function toSnapshot(row: PublicationRow | null, siteUrl: string | null): PublicationSnapshot | null {
  if (!row) return null;
  if (row.status === "published" && row.wpViewUrl && row.wpEditUrl) {
    return { status: "published", viewUrl: row.wpViewUrl, editUrl: row.wpEditUrl };
  }
  if (row.status === "wp_draft" && row.wpEditUrl && row.wpPostId && siteUrl) {
    return {
      status: "wp_draft",
      previewUrl: buildPreviewUrl(siteUrl, row.wpPostId),
      editUrl: row.wpEditUrl,
    };
  }
  if (row.status === "rolled_back") return { status: "rolled_back" };
  return null;
}

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

  // The approved revision once a decision exists; otherwise the latest
  // autosaved in-progress edit (or the original generation if there isn't
  // one yet). Reloading this page must never show — or let someone publish
  // from — a stale pre-edit original when a newer edit was autosaved.
  const draft: ContentDraft = {
    title: row.title ?? row.topic,
    markdown: currentDraftMarkdown(row),
    gates: row.gates ?? EMPTY_GATES,
  };

  // WordPress connection and any publish record belong to the draft's owner,
  // not necessarily the viewer — an admin reviewing someone else's draft must
  // see (and publish to) that owner's site, never their own.
  const [connection, publication] = await Promise.all([
    row.userId ? getWordPressConnectionStatus(row.userId) : Promise.resolve(null),
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
        wordPressConnected={connection !== null}
        initialPublication={toSnapshot(publication, connection?.siteUrl ?? null)}
        wordPressSiteUrl={connection?.siteUrl ?? null}
      />
    </main>
  );
}
