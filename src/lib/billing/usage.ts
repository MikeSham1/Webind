import { and, eq, gte, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { usageEvents } from "@/lib/db/schema";
import { getUserPlan } from "./store";
import { planById } from "./plans";

/**
 * Metered plan-quota enforcement for the paid features. Usage is counted per
 * calendar month (UTC) as SUM(quantity) per user + kind, and checked against the
 * user's plan limit. All DB access fails safe: if the database is unavailable we
 * never block a user on a phantom quota.
 */

export type UsageKind = "visibility_probe" | "fix_generation";

/** Map a usage kind to the plan-limit field that governs it. */
function monthlyLimit(planId: string, kind: UsageKind): number {
  const limits = planById(planId)?.limits;
  if (!limits) return 0;
  return kind === "visibility_probe"
    ? limits.visibilityPromptsPerMonth
    : limits.fixGenerationsPerMonth;
}

/** First instant of the current UTC calendar month. */
function startOfMonthUtc(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

type Database = NonNullable<ReturnType<typeof getDb>>;

async function withDb<T>(fallback: T, fn: (db: Database) => Promise<T>): Promise<T> {
  const db = getDb();
  if (!db) return fallback;
  try {
    return await fn(db);
  } catch (err) {
    console.error("usage query failed:", err);
    return fallback;
  }
}

/** SUM(quantity) of a user's usage of `kind` in the current UTC month. */
export async function usageThisMonth(userId: string, kind: UsageKind): Promise<number> {
  return withDb(0, async (db) => {
    const [row] = await db
      .select({ total: sql<number>`coalesce(sum(${usageEvents.quantity}), 0)` })
      .from(usageEvents)
      .where(
        and(
          eq(usageEvents.userId, userId),
          eq(usageEvents.kind, kind),
          gte(usageEvents.createdAt, startOfMonthUtc()),
        ),
      );
    return Number(row?.total ?? 0);
  });
}

/** Record `quantity` units of usage. Best-effort — never throws. */
export async function recordUsage(userId: string, kind: UsageKind, quantity = 1): Promise<void> {
  if (quantity <= 0) return;
  await withDb(undefined, async (db) => {
    await db.insert(usageEvents).values({ userId, kind, quantity });
  });
}

export interface Quota {
  /** -1 = unlimited, 0 = not on this plan, otherwise the monthly cap. */
  limit: number;
  used: number;
  /** Units left this month (Infinity when unlimited). */
  remaining: number;
  /** The feature is available on this plan at all (limit !== 0). */
  onPlan: boolean;
  /** There is at least 1 unit left to use right now. */
  allowed: boolean;
}

/** The user's current quota for a metered feature. */
export async function getQuota(userId: string, kind: UsageKind): Promise<Quota> {
  const plan = await getUserPlan(userId);
  const limit = monthlyLimit(plan, kind);
  if (limit === -1) {
    return { limit, used: 0, remaining: Infinity, onPlan: true, allowed: true };
  }
  if (limit === 0) {
    return { limit, used: 0, remaining: 0, onPlan: false, allowed: false };
  }
  const used = await usageThisMonth(userId, kind);
  const remaining = Math.max(0, limit - used);
  return { limit, used, remaining, onPlan: true, allowed: remaining > 0 };
}
