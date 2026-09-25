import { and, desc, eq, isNull } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { reportRequests, type ReportRequest } from "@/lib/db/schema";
import type { ReportResult } from "@/lib/scoring/types";
import type { OptimizationAssets } from "@/lib/optimize/assets";
import { canonicalHost } from "@/lib/domainInput";

/**
 * Cookie naming the visitor's own most recent anonymous report, so signing up
 * right after running one can claim it onto the new account instead of losing
 * it. Deliberately just an id in an httpOnly cookie bound to this browser —
 * never a value a form/URL could hand us, since claimPendingReport() below
 * only ever acts on whatever this specific browser's cookie says, and only
 * once (a signed-up-and-claimed id can't be reused to steal a later
 * anonymous report someone else ran and left a copy of this cookie for).
 */
export const PENDING_REPORT_COOKIE = "wb_pending_report";

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
 * logged in, or null for anonymous lead-gen runs. `optimizations` is stored
 * alongside so the ready-to-apply fixes (and the "open a PR" action built on
 * them) are still there when a signed-in user revisits this report later, not
 * just in the client state right after running it. Returns the new row id, or
 * null when persistence is disabled (no DATABASE_URL) or the write fails —
 * never throws, so a database hiccup can't break the user's report.
 */
export async function saveReportRequest(
  report: ReportResult,
  userId: string | null = null,
  optimizations: OptimizationAssets | null = null,
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
        optimizations,
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

/**
 * A user's own report runs for one host, oldest first — the shape a trend
 * chart wants. `url` is stored as the exact crawled URL (path included), not
 * a separate host column, so this filters in application code by
 * canonicalHost (lowercase, www-insensitive) rather than a SQL LIKE that
 * could false-match a substring of an unrelated domain, or a raw
 * `URL(...).host` comparison that would miss a www-prefixed report against
 * its canonical (www-stripped) site host. `host` is expected to already be
 * canonical (e.g. from resolveActiveSite/listSites), but is normalized here
 * too so a caller passing a raw domain still matches correctly.
 * Reads a wider window (200) than the dashboard's plain list (50) since a
 * tracked site is exactly the case where someone has run it many times.
 */
export async function listReportsForUserHost(
  userId: string,
  host: string,
): Promise<ReportRequest[]> {
  const target = canonicalHost(host) ?? host;
  const rows = await withDb("listReportsForUserHost", [], (db) =>
    db
      .select()
      .from(reportRequests)
      .where(eq(reportRequests.userId, userId))
      .orderBy(desc(reportRequests.createdAt))
      .limit(200),
  );
  return rows.filter((r) => canonicalHost(r.url) === target).reverse();
}

/**
 * The single newest report for one host — the shape a "current status" card
 * wants, distinct from {@link listReportsForUserHost}'s oldest-first history:
 * that function's own first element is the OLDEST matching report, not the
 * newest, and reading it as "latest" silently shows stale scores.
 */
export async function latestReportForUserHost(
  userId: string,
  host: string,
): Promise<ReportRequest | null> {
  const target = canonicalHost(host) ?? host;
  const rows = await withDb("latestReportForUserHost", [], (db) =>
    db
      .select()
      .from(reportRequests)
      .where(eq(reportRequests.userId, userId))
      .orderBy(desc(reportRequests.createdAt))
      .limit(200),
  );
  return rows.find((r) => canonicalHost(r.url) === target) ?? null;
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

/**
 * Attach a still-anonymous report to a just-created account — the "report,
 * account creation, the same report" first-run path: a visitor runs a free
 * report, signs up, and lands back on the exact report they ran instead of a
 * blank dashboard. Scoped to `userId IS NULL` so this can only ever claim a
 * genuinely unowned row, never re-point one that's already someone else's.
 */
export async function claimPendingReport(userId: string, requestId: string): Promise<boolean> {
  return withDb("claimPendingReport", false, async (db) => {
    const updated = await db
      .update(reportRequests)
      .set({ userId })
      .where(and(eq(reportRequests.id, requestId), isNull(reportRequests.userId)))
      .returning({ id: reportRequests.id });
    return updated.length > 0;
  });
}
