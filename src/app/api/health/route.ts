import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Liveness probe: the process can accept a request and respond at all. No
 * dependency checks (that's /api/ready) -- a container orchestrator uses this
 * to decide whether to restart the instance, and restarting because a
 * downstream dependency (the database) is briefly down would make an outage
 * worse, not better.
 */
export async function GET() {
  return NextResponse.json({ status: "ok" });
}
