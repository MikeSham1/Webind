import { and, desc, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { contentDrafts, type ContentDraftRow } from "@/lib/db/schema";
import type { ContentDraft, ContentInputs, DraftStatus, GateReport } from "./types";

/**
 * The text a draft's approval actually covers: the human's edit if they made
 * one when approving, otherwise the original generation. This is the ONLY
 * value that should ever be loaded, previewed, exported, or published for a
 * draft — reading `.markdown` directly anywhere downstream of approval risks
 * publishing text the approver never saw.
 */
export function approvedMarkdown(row: {
  markdown: string | null;
  humanFinal: string | null;
}): string {
  return row.humanFinal ?? row.markdown ?? "";
}

/**
 * The text to actually show when reopening a draft: the approved revision if
 * a decision has already been made, otherwise the latest autosaved in-progress
 * edit (falling back to the original generation if the reviewer hasn't edited
 * anything yet). Reading `.markdown` directly here would silently discard an
 * autosaved edit and show the reviewer their own stale first draft.
 */
export function currentDraftMarkdown(row: {
  markdown: string | null;
  humanFinal: string | null;
  editedMarkdown: string | null;
  status: DraftStatus;
}): string {
  if (row.status === "pending_review") return row.editedMarkdown ?? row.markdown ?? "";
  return approvedMarkdown(row);
}

type Database = NonNullable<ReturnType<typeof getDb>>;

/** Runs `fn` against the DB, or returns `fallback` when persistence is off or the query fails. Never throws. */
async function withDb<T>(
  label: string,
  fallback: T,
  fn: (db: Database) => Promise<T>,
): Promise<T> {
  const db = getDb();
  if (!db) return fallback;
  try {
    return await fn(db);
  } catch (err) {
    console.error(`${label} failed:`, err);
    return fallback;
  }
}

/**
 * Persist a generated draft (pending review). `userId` is the owner when
 * created while logged in, or null for anonymous drafts. Null when persistence
 * is off. Never throws.
 */
export async function saveDraft(
  inputs: ContentInputs,
  draft: ContentDraft,
  userId: string | null = null,
): Promise<string | null> {
  return withDb("saveDraft", null, async (db) => {
    const [row] = await db
      .insert(contentDrafts)
      .values({
        userId,
        topic: inputs.topic,
        targetUrl: inputs.targetUrl ?? null,
        inputs,
        title: draft.title,
        markdown: draft.markdown,
        gates: draft.gates,
        status: "pending_review",
      })
      .returning({ id: contentDrafts.id });
    return row?.id ?? null;
  });
}

/**
 * Approve or reject a draft the given user owns. Scoped by `userId` so one user
 * can't change another's draft, and reports the real row count so a bogus id
 * returns false instead of a false success. Never throws.
 */
export async function setDraftStatus(
  id: string,
  userId: string,
  status: DraftStatus,
  humanFinal?: string | null,
  gates?: GateReport,
): Promise<boolean> {
  return withDb("setDraftStatus", false, async (db) => {
    const updated = await db
      .update(contentDrafts)
      .set({
        status,
        updatedAt: new Date(),
        ...(humanFinal !== undefined ? { humanFinal } : {}),
        ...(gates !== undefined ? { gates } : {}),
      })
      .where(and(eq(contentDrafts.id, id), eq(contentDrafts.userId, userId)))
      .returning({ id: contentDrafts.id });
    return updated.length > 0;
  });
}

/**
 * Send a decided (approved or rejected) draft back to `pending_review` so it
 * can be edited and re-decided — "revise and resubmit," not a silent re-vote
 * on stale UI. Refuses for a draft that was never actually decided (nothing
 * to revise) or whose approval and `humanFinal` need to stay intact
 * (`setAnyDraftStatus`'s admin path doesn't call this; only the owner revises
 * their own draft). Carries the last decided text forward as the working
 * edit rather than snapping back to the model's original generation — a
 * rejected-then-revised draft should continue from what the reviewer was
 * actually looking at, not lose that context.
 */
export async function revertDraftToPendingReview(id: string, userId: string): Promise<boolean> {
  return withDb("revertDraftToPendingReview", false, async (db) => {
    const [row] = await db
      .select()
      .from(contentDrafts)
      .where(and(eq(contentDrafts.id, id), eq(contentDrafts.userId, userId)))
      .limit(1);
    if (!row || (row.status !== "approved" && row.status !== "rejected")) return false;

    const updated = await db
      .update(contentDrafts)
      .set({
        status: "pending_review",
        editedMarkdown: row.humanFinal ?? row.editedMarkdown,
        humanFinal: null,
        updatedAt: new Date(),
      })
      .where(eq(contentDrafts.id, id))
      .returning({ id: contentDrafts.id });
    return updated.length > 0;
  });
}

/**
 * Autosave an in-progress edit to a draft's markdown, before the reviewer has
 * approved or rejected it. Scoped to the owner and to `pending_review` — once
 * a decision exists, the edit is either promoted to `humanFinal` (by
 * decideDraftAction) or moot, so writing here after that would be silently
 * discarded state serving no purpose. Never throws; returns false rather than
 * surfacing a save failure to the reviewer mid-edit (a lost autosave isn't
 * worth interrupting them over — the textarea still holds their text).
 */
export async function saveDraftEdit(
  id: string,
  userId: string,
  markdown: string,
): Promise<boolean> {
  return withDb("saveDraftEdit", false, async (db) => {
    const updated = await db
      .update(contentDrafts)
      .set({ editedMarkdown: markdown, updatedAt: new Date() })
      .where(
        and(
          eq(contentDrafts.id, id),
          eq(contentDrafts.userId, userId),
          eq(contentDrafts.status, "pending_review"),
        ),
      )
      .returning({ id: contentDrafts.id });
    return updated.length > 0;
  });
}

/** A single draft owned by the user, or null. Never throws. */
export async function getDraftForUser(
  id: string,
  userId: string,
): Promise<ContentDraftRow | null> {
  return withDb("getDraftForUser", null, async (db) => {
    const [row] = await db
      .select()
      .from(contentDrafts)
      .where(and(eq(contentDrafts.id, id), eq(contentDrafts.userId, userId)))
      .limit(1);
    return row ?? null;
  });
}

/** A user's own recent drafts for the dashboard. Empty when persistence is off. */
export async function listDraftsForUser(userId: string): Promise<ContentDraftRow[]> {
  return withDb("listDraftsForUser", [], (db) =>
    db
      .select()
      .from(contentDrafts)
      .where(eq(contentDrafts.userId, userId))
      .orderBy(desc(contentDrafts.createdAt))
      .limit(50),
  );
}

/** All recent drafts (any owner). Admin only. */
export async function listAllDrafts(): Promise<ContentDraftRow[]> {
  return withDb("listAllDrafts", [], (db) =>
    db.select().from(contentDrafts).orderBy(desc(contentDrafts.createdAt)).limit(100),
  );
}

/** Any draft by id, regardless of owner. Admin only. */
export async function getDraftById(id: string): Promise<ContentDraftRow | null> {
  return withDb("getDraftById", null, async (db) => {
    const [row] = await db
      .select()
      .from(contentDrafts)
      .where(eq(contentDrafts.id, id))
      .limit(1);
    return row ?? null;
  });
}

/** Set any draft's status (any owner). Admin only. Never throws. */
export async function setAnyDraftStatus(
  id: string,
  status: DraftStatus,
  humanFinal?: string | null,
  gates?: GateReport,
): Promise<boolean> {
  return withDb("setAnyDraftStatus", false, async (db) => {
    const updated = await db
      .update(contentDrafts)
      .set({
        status,
        updatedAt: new Date(),
        ...(humanFinal !== undefined ? { humanFinal } : {}),
        ...(gates !== undefined ? { gates } : {}),
      })
      .where(eq(contentDrafts.id, id))
      .returning({ id: contentDrafts.id });
    return updated.length > 0;
  });
}
