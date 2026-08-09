import { desc } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { auditLog, type AuditLogRow } from "@/lib/db/schema";
import { logInfo, logWarn } from "@/lib/log";

export interface AuditEntry {
  /** Who did it. Null for a system-initiated action (e.g. a cron job). */
  actorUserId: string | null;
  /** e.g. "wordpress.create_draft", "wordpress.publish", "github.open_pr". */
  action: string;
  /** e.g. the WordPress site URL or "owner/repo" — where the write landed. */
  destination: string;
  beforeState?: unknown;
  afterState?: unknown;
  result: "success" | "failure";
  error?: string;
}

/**
 * Append an audit entry for a write WeBind made to a customer's external site
 * or repo. Best-effort and never throws — an audit-log failure must not be
 * allowed to break (or silently mask the outcome of) the write it's
 * recording, so this is always called AFTER the real action, purely to
 * record what already happened.
 */
export async function recordAudit(entry: AuditEntry): Promise<void> {
  // Always visible in logs even without a database, and independent of it —
  // structured logs and the DB audit trail are two different retention/query
  // tools, not a primary/fallback pair.
  const log = entry.result === "success" ? logInfo : logWarn;
  log("audit", {
    actorUserId: entry.actorUserId,
    action: entry.action,
    destination: entry.destination,
    result: entry.result,
    error: entry.error,
  });

  const db = getDb();
  if (!db) return;
  try {
    await db.insert(auditLog).values({
      actorUserId: entry.actorUserId,
      action: entry.action,
      destination: entry.destination,
      beforeState: entry.beforeState ?? null,
      afterState: entry.afterState ?? null,
      result: entry.result,
      error: entry.error ?? null,
    });
  } catch (err) {
    console.error("recordAudit failed:", err);
  }
}

/** Recent audit entries for an admin view. Never throws. */
export async function listAuditLog(limit = 100): Promise<AuditLogRow[]> {
  const db = getDb();
  if (!db) return [];
  try {
    return await db.select().from(auditLog).orderBy(desc(auditLog.createdAt)).limit(limit);
  } catch (err) {
    console.error("listAuditLog failed:", err);
    return [];
  }
}
