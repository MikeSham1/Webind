import { and, desc, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { contentDrafts, type ContentDraftRow } from "@/lib/db/schema";
import type { ContentDraft, ContentInputs, DraftStatus } from "./types";

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
): Promise<boolean> {
  return withDb("setDraftStatus", false, async (db) => {
    const updated = await db
      .update(contentDrafts)
      .set({ status, updatedAt: new Date() })
      .where(and(eq(contentDrafts.id, id), eq(contentDrafts.userId, userId)))
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
): Promise<boolean> {
  return withDb("setAnyDraftStatus", false, async (db) => {
    const updated = await db
      .update(contentDrafts)
      .set({ status, updatedAt: new Date() })
      .where(eq(contentDrafts.id, id))
      .returning({ id: contentDrafts.id });
    return updated.length > 0;
  });
}
