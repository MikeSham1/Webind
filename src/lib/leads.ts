import { desc, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { reportRequests, type ReportRequest } from "@/lib/db/schema";
import type { ReportResult } from "@/lib/scoring/types";

/**
 * Persist a report run. Returns the new row id, or null when persistence is
 * disabled (no DATABASE_URL) or the write fails — never throws, so a database
 * hiccup can never break the user's report.
 */
export async function saveReportRequest(
  report: ReportResult,
): Promise<string | null> {
  const db = getDb();
  if (!db) return null;
  try {
    const [row] = await db
      .insert(reportRequests)
      .values({
        url: report.url,
        aiTotal: report.ai.total,
        traditionalTotal: report.traditional.total,
        report,
      })
      .returning({ id: reportRequests.id });
    return row?.id ?? null;
  } catch (err) {
    console.error("saveReportRequest failed:", err);
    return null;
  }
}

/** Recent report runs for the dashboard. Empty when persistence is off. */
export async function listReports(): Promise<ReportRequest[]> {
  const db = getDb();
  if (!db) return [];
  try {
    return await db
      .select()
      .from(reportRequests)
      .orderBy(desc(reportRequests.createdAt))
      .limit(50);
  } catch (err) {
    console.error("listReports failed:", err);
    return [];
  }
}

/** Attach a lead's email to a previously-saved report run. Never throws. */
export async function attachEmail(
  requestId: string,
  email: string,
): Promise<boolean> {
  const db = getDb();
  if (!db) return false;
  try {
    await db
      .update(reportRequests)
      .set({ email })
      .where(eq(reportRequests.id, requestId));
    return true;
  } catch (err) {
    console.error("attachEmail failed:", err);
    return false;
  }
}
