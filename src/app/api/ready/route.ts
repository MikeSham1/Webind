import { NextResponse } from "next/server";
import { crawlSlotStats } from "@/lib/crawler/browser";
import { checkDatabaseHealth } from "@/lib/db/health";

export const dynamic = "force-dynamic";

/**
 * Readiness probe: can this instance actually serve traffic right now.
 *
 * The database is checked with a real (trivially cheap) query, not just "is
 * DATABASE_URL set" -- that's the difference between readiness and liveness.
 * `not_configured` fails readiness too, same as `unreachable`: accounts,
 * billing, reports, drafts, and publications are all non-functional without
 * one, and DATABASE_URL is a required production variable (see LAUNCH.md) —
 * this used to report "ok" when it was simply unset, which is exactly the
 * silent-misconfiguration case a readiness probe exists to catch. The
 * crawler's admission-control stats are reported for visibility but never
 * fail readiness on their own: a full crawl queue means "busy", not "broken",
 * and every other route (auth, dashboard, static pages) is unaffected by it.
 */
export async function GET() {
  const database = await checkDatabaseHealth();
  const crawler = crawlSlotStats();
  const healthy = database === "ok";

  return NextResponse.json(
    { status: healthy ? "ok" : "degraded", database, crawler },
    { status: healthy ? 200 : 503 },
  );
}
