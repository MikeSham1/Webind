import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { codeFixPrs, type CodeFixPrRow } from "@/lib/db/schema";
import type { OpenedPullRequest } from "./github";

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
 * The PR record for a report, if any. Not user-scoped: callers look this up
 * only after already loading the report itself via `getReportForUser` /
 * `getReportById`, which is where the ownership check happens.
 */
export async function getPrForReport(reportRequestId: string): Promise<CodeFixPrRow | null> {
  return withDb("getPrForReport", null, async (db) => {
    const [row] = await db
      .select()
      .from(codeFixPrs)
      .where(eq(codeFixPrs.reportRequestId, reportRequestId))
      .limit(1);
    return row ?? null;
  });
}

/** Record a newly opened PR for a report. Never throws (returns false on failure). */
export async function recordPrOpened(
  reportRequestId: string,
  userId: string,
  pr: OpenedPullRequest,
): Promise<boolean> {
  return withDb("recordPrOpened", false, async (db) => {
    await db.insert(codeFixPrs).values({
      reportRequestId,
      userId,
      prNumber: pr.prNumber,
      prUrl: pr.prUrl,
      branchName: pr.branchName,
    });
    return true;
  });
}
