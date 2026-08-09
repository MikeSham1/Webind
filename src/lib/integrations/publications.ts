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

/**
 * A `pending` row older than this is treated as an abandoned/crashed attempt
 * (the process died mid-request, a deploy restarted it, etc.) rather than a
 * genuinely in-flight one — long enough that no real WordPress round-trip
 * should still be running, short enough that a stuck row doesn't block a user
 * for very long.
 */
const PENDING_TIMEOUT_MS = 2 * 60 * 1000;

export type BeginPublishResult =
  | { ok: true }
  | { ok: false; reason: "already_active"; row: PublicationRow }
  | { ok: false; reason: "in_progress" };

/**
 * Claim the right to attempt a publish for `draftId`, writing a `pending` row
 * BEFORE any WordPress call is made — the core of "record pending before
 * calling, reconcile after". This is what lets a retry tell "nothing happened
 * yet, safe to try" apart from "something may already exist on WordPress,
 * don't blindly create a duplicate":
 *
 * - No row, or the last attempt ended in `failed`/`rolled_back`, or a
 *   `pending` row has clearly gone stale: claim it (insert/update to
 *   `pending`) and let the caller proceed.
 * - `wp_draft`/`published`: something real already exists on WordPress —
 *   return it as-is rather than creating a second page.
 * - A `pending` row that's still fresh: a publish is genuinely in flight
 *   (e.g. a double-click); refuse the concurrent duplicate.
 */
export async function beginPublish(draftId: string, userId: string): Promise<BeginPublishResult> {
  return withDb("beginPublish", { ok: true } as BeginPublishResult, async (db) => {
    const [existing] = await db
      .select()
      .from(publications)
      .where(eq(publications.draftId, draftId))
      .limit(1);

    if (existing) {
      if (existing.status === "wp_draft" || existing.status === "published") {
        return { ok: false, reason: "already_active", row: existing };
      }
      if (existing.status === "pending") {
        const age = Date.now() - existing.updatedAt.getTime();
        if (age < PENDING_TIMEOUT_MS) {
          return { ok: false, reason: "in_progress" };
        }
        // Older than the timeout: treat as abandoned and reclaim it below.
      }
      await db
        .update(publications)
        .set({ userId, status: "pending", updatedAt: new Date(), error: null })
        .where(eq(publications.id, existing.id));
      return { ok: true };
    }

    await db.insert(publications).values({ draftId, userId, status: "pending" });
    return { ok: true };
  });
}

/** Record that WordPress accepted the page as a DRAFT — not live yet. */
export async function recordWpDraftCreated(
  draftId: string,
  page: PublishedPage,
): Promise<boolean> {
  return withDb("recordWpDraftCreated", false, async (db) => {
    const updated = await db
      .update(publications)
      .set({
        wpPostId: page.postId,
        wpViewUrl: page.viewUrl,
        wpEditUrl: page.editUrl,
        status: "wp_draft",
        updatedAt: new Date(),
        error: null,
      })
      .where(eq(publications.draftId, draftId))
      .returning({ id: publications.id });
    return updated.length > 0;
  });
}

/** Record that the page is now confirmed live. Falls back to insert if no row exists (defensive). */
export async function recordPublished(
  draftId: string,
  userId: string,
  page: PublishedPage,
): Promise<boolean> {
  return withDb("recordPublished", false, async (db) => {
    const now = new Date();
    const updated = await db
      .update(publications)
      .set({
        wpPostId: page.postId,
        wpViewUrl: page.viewUrl,
        wpEditUrl: page.editUrl,
        status: "published",
        publishedAt: now,
        rolledBackAt: null,
        updatedAt: now,
        error: null,
      })
      .where(eq(publications.draftId, draftId))
      .returning({ id: publications.id });
    if (updated.length > 0) return true;

    // No row to update — shouldn't happen via the normal beginPublish flow,
    // but stay robust rather than silently losing the record of a real publish.
    await db.insert(publications).values({
      draftId,
      userId,
      wpPostId: page.postId,
      wpViewUrl: page.viewUrl,
      wpEditUrl: page.editUrl,
      status: "published",
      publishedAt: now,
    });
    return true;
  });
}

/** Record that a WordPress write attempt failed — the reconciliation hook for the next retry. */
export async function recordPublishFailed(draftId: string, error: string): Promise<boolean> {
  return withDb("recordPublishFailed", false, async (db) => {
    const updated = await db
      .update(publications)
      .set({ status: "failed", error, updatedAt: new Date() })
      .where(eq(publications.draftId, draftId))
      .returning({ id: publications.id });
    return updated.length > 0;
  });
}

/** Mark a publication rolled back (the WP page was already flipped to draft by the caller). */
export async function recordRolledBack(draftId: string): Promise<boolean> {
  return withDb("recordRolledBack", false, async (db) => {
    const updated = await db
      .update(publications)
      .set({ status: "rolled_back", rolledBackAt: new Date(), updatedAt: new Date() })
      .where(eq(publications.draftId, draftId))
      .returning({ id: publications.id });
    return updated.length > 0;
  });
}
