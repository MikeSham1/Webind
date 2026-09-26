import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { plannerConversations } from "@/lib/db/schema";
import type { PlannerMessage } from "@/app/studio/planner-state";

/**
 * Persistence for the "Plan it out loud" conversation — one resumable
 * scratchpad per user, not a history of named threads. Every function is
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

/** The user's in-progress planner conversation, or an empty one if they've never started/saved one. */
export async function getPlannerConversation(userId: string): Promise<PlannerMessage[]> {
  return withDb("getPlannerConversation", [], async (db) => {
    const [row] = await db
      .select({ messages: plannerConversations.messages })
      .from(plannerConversations)
      .where(eq(plannerConversations.userId, userId))
      .limit(1);
    return (row?.messages as PlannerMessage[] | undefined) ?? [];
  });
}

/** Save the full conversation so far. Upserts — one row per user. Best-effort. */
export async function savePlannerConversation(
  userId: string,
  messages: PlannerMessage[],
): Promise<void> {
  await withDb("savePlannerConversation", undefined, async (db) => {
    await db
      .insert(plannerConversations)
      .values({ userId, messages, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: plannerConversations.userId,
        set: { messages, updatedAt: new Date() },
      });
  });
}

/** Clear the saved conversation — "start over" in the planner UI. Best-effort. */
export async function clearPlannerConversation(userId: string): Promise<void> {
  await withDb("clearPlannerConversation", undefined, async (db) => {
    await db.delete(plannerConversations).where(eq(plannerConversations.userId, userId));
  });
}
