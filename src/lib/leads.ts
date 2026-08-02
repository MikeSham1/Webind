import { and, desc, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { reportRequests, type ReportRequest } from "@/lib/db/schema";
import type { ReportResult } from "@/lib/scoring/types";

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
 * Persist a report run. `userId` is the owner when the run was made while
 * logged in, or null for anonymous lead-gen runs. Returns the new row id, or
 * null when persistence is disabled (no DATABASE_URL) or the write fails —
 * never throws, so a database hiccup can't break the user's report.
 */
export async function saveReportRequest(
  report: ReportResult,
  userId: string | null = null,
): Promise<string | null> {
  return withDb("saveReportRequest", null, async (db) => {
    const [row] = await db
      .insert(reportRequests)
      .values({
        userId,
        url: report.url,
        aiTotal: report.ai.total,
        traditionalTotal: report.traditional.total,
        report,
      })
      .returning({ id: reportRequests.id });
    return row?.id ?? null;
  });
}

/** A user's own recent report runs. Empty when persistence is off. */
export async function listReportsForUser(userId: string): Promise<ReportRequest[]> {
  return withDb("listReportsForUser", [], (db) =>
    db
      .select()
      .from(reportRequests)
      .where(eq(reportRequests.userId, userId))
      .orderBy(desc(reportRequests.createdAt))
      .limit(50),
  );
}

/** All recent report runs, including anonymous lead-gen ones. Admin only. */
export async function listAllReports(): Promise<ReportRequest[]> {
  return withDb("listAllReports", [], (db) =>
    db.select().from(reportRequests).orderBy(desc(reportRequests.createdAt)).limit(100),
  );
}

/** A single report run owned by the user, or null. Never throws. */
export async function getReportForUser(
  id: string,
  userId: string,
): Promise<ReportRequest | null> {
  return withDb("getReportForUser", null, async (db) => {
    const [row] = await db
      .select()
      .from(reportRequests)
      .where(and(eq(reportRequests.id, id), eq(reportRequests.userId, userId)))
      .limit(1);
    return row ?? null;
  });
}

/** Any report run by id, regardless of owner. Admin only. */
export async function getReportById(id: string): Promise<ReportRequest | null> {
  return withDb("getReportById", null, async (db) => {
    const [row] = await db
      .select()
      .from(reportRequests)
      .where(eq(reportRequests.id, id))
      .limit(1);
    return row ?? null;
  });
}

/**
 * Attach a lead's email to a previously-saved report run. Never throws.
 *
 * Returns false when no row matched. An UPDATE that hits zero rows resolves
 * happily, so returning a bare `true` told visitors with a stale or bogus
 * requestId "you're on the list" while the lead was silently dropped —
 * `.returning()` makes the row count the actual answer.
 */
export async function attachEmail(
  requestId: string,
  email: string,
): Promise<boolean> {
  return withDb("attachEmail", false, async (db) => {
    const updated = await db
      .update(reportRequests)
      .set({ email })
      .where(eq(reportRequests.id, requestId))
      .returning({ id: reportRequests.id });
    return updated.length > 0;
  });
}
