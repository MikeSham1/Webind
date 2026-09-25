import { eq, isNull, lt, or } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { stripeEvents, subscriptions, type SubscriptionRow } from "@/lib/db/schema";
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

/** True when the user already has a Stripe subscription that grants paid access. */
export async function hasActiveSubscription(userId: string): Promise<boolean> {
  const sub = await getSubscription(userId);
  return Boolean(sub && ACTIVE_STATUSES.has(sub.status));
}

export type UpsertSubscriptionResult =
  | "applied"
  | "skipped_stale"
  | "failed";

/**
 * Insert or update the user's single subscription row (keyed by userId).
 *
 * Returns, rather than swallows, the outcome: a caller that needs to know
 * whether the write actually happened (the Stripe webhook, so it can decide
 * whether to acknowledge or ask for a retry) gets a real answer instead of
 * always seeing success.
 *
 * `eventCreatedAt`, when given, makes the write atomic-and-ordered: the
 * update is applied only if no later event has already been recorded (a
 * single `INSERT ... ON CONFLICT DO UPDATE ... WHERE`, not a read-then-write,
 * so two out-of-order webhook deliveries can't race each other into applying
 * in the wrong order). Omit it only for callers with no event to anchor to
 * (tests, manual admin fixes) — those always apply unconditionally.
 */
export async function upsertSubscription(input: {
  userId: string;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  plan: string;
  status: string;
  currentPeriodEnd?: Date | null;
  eventCreatedAt?: Date;
}): Promise<UpsertSubscriptionResult> {
  const db = getDb();
  if (!db) return "failed"; // billing state literally cannot be recorded — never silently "succeed"
  try {
    const values = {
      userId: input.userId,
      stripeCustomerId: input.stripeCustomerId ?? null,
      stripeSubscriptionId: input.stripeSubscriptionId ?? null,
      plan: input.plan,
      status: input.status,
      currentPeriodEnd: input.currentPeriodEnd ?? null,
      lastStripeEventCreatedAt: input.eventCreatedAt ?? null,
      updatedAt: new Date(),
    };
    const written = await db
      .insert(subscriptions)
      .values(values)
      .onConflictDoUpdate({
        target: subscriptions.userId,
        set: values,
        ...(input.eventCreatedAt
          ? {
              setWhere: or(
                isNull(subscriptions.lastStripeEventCreatedAt),
                lt(subscriptions.lastStripeEventCreatedAt, input.eventCreatedAt),
              ),
            }
          : {}),
      })
      .returning({ id: subscriptions.id });
    // A fresh insert always returns a row; a conflicting update whose
    // setWhere didn't match returns none — that's the "stale, skip" signal.
    return written.length > 0 ? "applied" : "skipped_stale";
  } catch (err) {
    console.error("upsertSubscription failed:", err);
    return "failed";
  }
}

/** True if this Stripe event id has already been fully processed. Fails open to "not processed" so a DB hiccup degrades to reprocessing (safe — upserts are idempotent) rather than silently dropping the event. */
export async function wasStripeEventProcessed(eventId: string): Promise<boolean> {
  return withDb("wasStripeEventProcessed", false, async (db) => {
    const [row] = await db
      .select({ id: stripeEvents.id })
      .from(stripeEvents)
      .where(eq(stripeEvents.id, eventId))
      .limit(1);
    return Boolean(row);
  });
}

/** Record a Stripe event id as processed. Best-effort: never throws, never blocks the response. */
export async function markStripeEventProcessed(eventId: string, type: string): Promise<void> {
  await withDb("markStripeEventProcessed", undefined, async (db) => {
    await db.insert(stripeEvents).values({ id: eventId, type }).onConflictDoNothing();
  });
}
