import { NextResponse, type NextRequest } from "next/server";
import { cleanupExpiredSessions } from "@/lib/auth";
import { safeEqual } from "@/lib/gate";
import { logInfo } from "@/lib/log";

export const dynamic = "force-dynamic";

/**
 * Delete every expired session row. Meant to be called regularly by an
 * external scheduler (Railway Cron, a GitHub Actions schedule, cron-job.org,
 * etc.) — `createSession` also does a cheap probabilistic sweep on its own, so
 * this endpoint isn't the only thing keeping the table bounded, but a real
 * schedule is more thorough than "eventually, maybe, on some login".
 *
 * Protected by a shared secret (`CRON_SECRET`) rather than a user session,
 * since the caller is a scheduler, not a browser. When the secret isn't
 * configured, the endpoint refuses everything — fail closed, not open.
 */
export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET is not configured." }, { status: 503 });
  }

  const provided = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!safeEqual(provided, secret)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const removed = await cleanupExpiredSessions();
  logInfo("cron.cleanup_sessions", { removed });
  return NextResponse.json({ removed });
}
