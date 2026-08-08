import { NextResponse } from "next/server";
import { crawlSlotStats } from "@/lib/crawler/browser";
import { checkDatabaseHealth } from "@/lib/db/health";

export const dynamic = "force-dynamic";

/**
 * Readiness probe: can this instance actually serve traffic right now.
 *
 * The database is checked with a real (trivially cheap) query, not just "is
 * DATABASE_URL set" -- that's the difference between readiness and liveness.
 * The crawler's admission-control stats are reported for visibility but never
 * fail readiness on their own: a full crawl queue means "busy", not "broken",
 * and every other route (auth, dashboard, static pages) is unaffected by it.
 */
export async function GET() {
  const database = await checkDatabaseHealth();
  const crawler = crawlSlotStats();
  const healthy = database !== "unreachable";

  return NextResponse.json(
    { status: healthy ? "ok" : "degraded", database, crawler },
    { status: healthy ? 200 : 503 },
  );
}
