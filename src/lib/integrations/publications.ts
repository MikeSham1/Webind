import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { publications, type PublicationRow } from "@/lib/db/schema";
import type { PublishedPage } from "./wordpress";

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
 * The publish record for a draft, if any. Not user-scoped: callers look this
 * up only after already loading the draft itself via `getDraftForUser` /
 * `getDraftById`, which is where the ownership check happens.
 */
export async function getPublicationForDraft(draftId: string): Promise<PublicationRow | null> {
  return withDb("getPublicationForDraft", null, async (db) => {
    const [row] = await db
      .select()
      .from(publications)
      .where(eq(publications.draftId, draftId))
      .limit(1);
    return row ?? null;
  });
}

/** Record a fresh publish or a republish-after-rollback. Upserts on draftId. Never throws (returns false on failure). */
export async function recordPublished(
  draftId: string,
  userId: string,
  page: PublishedPage,
): Promise<boolean> {
  return withDb("recordPublished", false, async (db) => {
    const now = new Date();
    await db
      .insert(publications)
      .values({
        draftId,
        userId,
        wpPostId: page.postId,
        wpViewUrl: page.viewUrl,
        wpEditUrl: page.editUrl,
        status: "published",
        publishedAt: now,
        rolledBackAt: null,
      })
      .onConflictDoUpdate({
        target: publications.draftId,
        set: {
          wpPostId: page.postId,
          wpViewUrl: page.viewUrl,
          wpEditUrl: page.editUrl,
          status: "published",
          publishedAt: now,
          rolledBackAt: null,
        },
      });
    return true;
  });
}

/** Mark a publication rolled back (the WP page was already flipped to draft by the caller). */
export async function recordRolledBack(draftId: string): Promise<boolean> {
  return withDb("recordRolledBack", false, async (db) => {
    const updated = await db
      .update(publications)
      .set({ status: "rolled_back", rolledBackAt: new Date() })
      .where(eq(publications.draftId, draftId))
      .returning({ id: publications.id });
    return updated.length > 0;
  });
}
