import { and, eq } from "drizzle-orm";
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
  | { ok: false; reason: "in_progress" }
  | { ok: false; reason: "claim_failed" };

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
 *
 * A permission-granting check must fail CLOSED: `withDb`'s fallback on any
 * error here is `claim_failed`, never `ok: true` (this previously returned
 * `{ ok: true }` on any database error — including the unique-constraint
 * violation from two concurrent inserts racing on the same draftId — which
 * handed BOTH callers permission to publish). Every claim is also written
 * with a compare-and-swap on the row's `updatedAt` rather than a bare
 * update, so two callers racing to reclaim the same stale/failed row can
 * only ever have one of them actually win.
 */
export async function beginPublish(draftId: string, userId: string): Promise<BeginPublishResult> {
  return withDb(
    "beginPublish",
    { ok: false, reason: "claim_failed" } as BeginPublishResult,
    async (db) => {
      const [existing] = await db
        .select()
        .from(publications)
        .where(eq(publications.draftId, draftId))
        .limit(1);

      if (!existing) {
        try {
          await db.insert(publications).values({ draftId, userId, status: "pending" });
          return { ok: true };
        } catch {
          // Unique constraint on draftId: another request's insert won the
          // race between our SELECT and this INSERT. Fail closed.
          return { ok: false, reason: "claim_failed" };
        }
      }

      if (existing.status === "wp_draft" || existing.status === "published") {
        return { ok: false, reason: "already_active", row: existing };
      }

      if (existing.status === "pending") {
        const age = Date.now() - existing.updatedAt.getTime();
        if (age < PENDING_TIMEOUT_MS) {
          return { ok: false, reason: "in_progress" };
        }
        // Older than the timeout: treat as abandoned and fall through to reclaim.
      }

      // failed / rolled_back / stale pending: reclaim it, but only if the row
      // is still exactly the one we just read.
      const claimed = await db
        .update(publications)
        .set({ userId, status: "pending", updatedAt: new Date(), error: null })
        .where(and(eq(publications.id, existing.id), eq(publications.updatedAt, existing.updatedAt)))
        .returning({ id: publications.id });
      return claimed.length > 0 ? { ok: true } : { ok: false, reason: "claim_failed" };
    },
  );
}

/** Which WordPress connection and content type a write actually targeted — captured once, at creation. */
export interface PublishDestination {
  siteUrl: string;
  connectionId: string;
  postType: "page" | "post";
}

/**
 * Record that WordPress accepted the page as a DRAFT — not live yet. This is
 * the ONLY place wpSiteUrl/wpConnectionId are ever set: the destination a
 * post lives on doesn't change just because the user later reconnects
 * WordPress to somewhere else.
 */
export async function recordWpDraftCreated(
  draftId: string,
  page: PublishedPage,
  destination: PublishDestination,
): Promise<boolean> {
  return withDb("recordWpDraftCreated", false, async (db) => {
    const updated = await db
      .update(publications)
      .set({
        wpPostId: page.postId,
        wpViewUrl: page.viewUrl,
        wpEditUrl: page.editUrl,
        wpSiteUrl: destination.siteUrl,
        wpConnectionId: destination.connectionId,
        wpPostType: destination.postType,
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
    // wpSiteUrl/wpConnectionId are unknown here (this path never went through
    // recordWpDraftCreated), so the destination check downstream degrades to
    // "unverifiable" for this row rather than false-matching a guess.
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

/**
 * True when a stored publication's destination is either unverifiable (a
 * legacy row from before wpSiteUrl was tracked — allowed through, since we
 * genuinely don't know better) or matches the site the caller is currently
 * about to write to. False means the current WordPress connection points
 * somewhere other than where this post was actually created — e.g. the user
 * disconnected site A and connected site B, and this row's wpPostId means
 * something else entirely (or nothing) on site B.
 */
export function destinationMatches(
  publication: Pick<PublicationRow, "wpSiteUrl">,
  currentSiteUrl: string,
): boolean {
  return publication.wpSiteUrl === null || publication.wpSiteUrl === currentSiteUrl;
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
