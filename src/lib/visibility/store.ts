import { desc } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { visibilityOutcomes, type VisibilityOutcomeRow } from "@/lib/db/schema";
import type { VisibilityReport } from "./types";

type Database = NonNullable<ReturnType<typeof getDb>>;

/** Run `fn` against the DB, or return `fallback` when persistence is off / the query fails. Never throws. */
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
 * Persist a completed visibility run as a real AI-surfacing outcome — the
 * ground-truth signal the readiness model can be retrained on. Best-effort:
 * `userId` is the owner (or null), and a database hiccup never breaks the
 * user's visibility check. Returns the new row id, or null.
 */
export async function saveVisibilityOutcome(
  report: VisibilityReport,
  userId: string | null = null,
): Promise<string | null> {
  return withDb("saveVisibilityOutcome", null, async (db) => {
    const [row] = await db
      .insert(visibilityOutcomes)
      .values({
        userId,
        domain: report.domain,
        brandName: report.brandName || null,
        overallScore: report.overallScore,
        coverageBps: Math.round(report.coverage * 1000),
        report,
      })
      .returning({ id: visibilityOutcomes.id });
    return row?.id ?? null;
  });
}

/** All stored visibility outcomes, newest first. Empty when persistence is off. */
export async function listVisibilityOutcomes(
  limit = 5000,
): Promise<VisibilityOutcomeRow[]> {
  return withDb("listVisibilityOutcomes", [], (db) =>
    db
      .select()
      .from(visibilityOutcomes)
      .orderBy(desc(visibilityOutcomes.createdAt))
      .limit(limit),
  );
}
