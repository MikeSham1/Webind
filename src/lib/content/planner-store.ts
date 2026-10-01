import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { plannerConversations } from "@/lib/db/schema";
import type { PlannerMessage } from "@/app/studio/planner-state";

/**
 * Persistence for the "Plan it out loud" conversation — one resumable
 * scratchpad per (user, site), not a history of named threads. Scoped to the
 * site because the conversation's own replies are generated with that site's
 * name/scores as context (see buildSiteContext in planner-actions.ts); a
 * single global conversation would show site B's chat while the planner is
 * actually scoped to site A the moment someone switches. Every function is
 * fail-soft (never throws) so a database hiccup can't break the planner UI,
 * matching every other store in this codebase.
 */

type Database = NonNullable<ReturnType<typeof getDb>>;

async function withDb<T>(label: string, fallback: T, fn: (db: Database) => Promise<T>): Promise<T> {
  const db = getDb();
  if (!db) return fallback;
  try {
    return await fn(db);
  } catch (err) {
    console.error(`${label} failed:`, err);
    return fallback;
  }
}

function scopeFilter(userId: string, siteId: string | null) {
  return siteId
    ? and(eq(plannerConversations.userId, userId), eq(plannerConversations.siteId, siteId))
    : and(eq(plannerConversations.userId, userId), isNull(plannerConversations.siteId));
}

/** The user's in-progress planner conversation for this site, or an empty one if they've never started/saved one. */
export async function getPlannerConversation(
  userId: string,
  siteId: string | null,
): Promise<PlannerMessage[]> {
  return withDb("getPlannerConversation", [], async (db) => {
    const [row] = await db
      .select({ messages: plannerConversations.messages })
      .from(plannerConversations)
      .where(scopeFilter(userId, siteId))
      .limit(1);
    return (row?.messages as PlannerMessage[] | undefined) ?? [];
  });
}

/**
 * Save the full conversation so far, scoped to this (user, site). Upserts via
 * select-then-branch rather than ON CONFLICT: see the siteId comment on the
 * schema for why a DB-level unique constraint doesn't cleanly cover the
 * nullable-site case. Best-effort.
 */
export async function savePlannerConversation(
  userId: string,
  siteId: string | null,
  messages: PlannerMessage[],
): Promise<void> {
  await withDb("savePlannerConversation", undefined, async (db) => {
    const [existing] = await db
      .select({ id: plannerConversations.id })
      .from(plannerConversations)
      .where(scopeFilter(userId, siteId))
      .limit(1);
    if (existing) {
      await db
        .update(plannerConversations)
        .set({ messages, updatedAt: new Date() })
        .where(eq(plannerConversations.id, existing.id));
    } else {
      await db.insert(plannerConversations).values({ userId, siteId, messages, updatedAt: new Date() });
    }
  });
}

/** Clear the saved conversation for this (user, site) — "start over" in the planner UI. Best-effort. */
export async function clearPlannerConversation(userId: string, siteId: string | null): Promise<void> {
  await withDb("clearPlannerConversation", undefined, async (db) => {
    await db.delete(plannerConversations).where(scopeFilter(userId, siteId));
  });
}
