import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { subscriptions, type SubscriptionRow } from "@/lib/db/schema";
import { DEFAULT_PLAN, planById, type PlanId } from "./plans";

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

/** Statuses that grant paid access. Anything else is treated as free. */
const ACTIVE_STATUSES = new Set(["active", "trialing"]);

export async function getSubscription(userId: string): Promise<SubscriptionRow | null> {
  return withDb("getSubscription", null, async (db) => {
    const [row] = await db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.userId, userId))
      .limit(1);
    return row ?? null;
  });
}

/**
 * The user's effective plan: their subscription's plan when it's active/
 * trialing and the plan id is known, otherwise free. Never throws.
 */
export async function getUserPlan(userId: string): Promise<PlanId> {
  const sub = await getSubscription(userId);
  if (!sub || !ACTIVE_STATUSES.has(sub.status)) return DEFAULT_PLAN;
  return planById(sub.plan)?.id ?? DEFAULT_PLAN;
}

/** Insert or update the user's single subscription row (keyed by userId). */
export async function upsertSubscription(input: {
  userId: string;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  plan: string;
  status: string;
  currentPeriodEnd?: Date | null;
}): Promise<void> {
  await withDb("upsertSubscription", undefined, async (db) => {
    const values = {
      userId: input.userId,
      stripeCustomerId: input.stripeCustomerId ?? null,
      stripeSubscriptionId: input.stripeSubscriptionId ?? null,
      plan: input.plan,
      status: input.status,
      currentPeriodEnd: input.currentPeriodEnd ?? null,
      updatedAt: new Date(),
    };
    await db
      .insert(subscriptions)
      .values(values)
      .onConflictDoUpdate({ target: subscriptions.userId, set: values });
  });
}
