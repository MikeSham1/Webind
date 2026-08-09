import { createHash, randomBytes } from "node:crypto";
import { cookies, headers } from "next/headers";
import { and, desc, eq, gt, lt, ne } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { sessions, users, type SessionRow } from "@/lib/db/schema";
import { hashPassword, verifyPassword } from "./password";

const SESSION_COOKIE = "wb_session";
const SESSION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export interface AuthUser {
  id: string;
  email: string;
  isAdmin: boolean;
  /** The current session's row id — lets callers mark "this device" in a session list. */
  sessionId: string;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** Best-effort request metadata, captured only to help a user recognize their own sessions. */
async function requestMeta(): Promise<{ userAgent: string | null; ip: string | null }> {
  const h = await headers();
  const forwarded = h.get("x-forwarded-for");
  const ip = forwarded?.split(",")[0]?.trim() || h.get("x-real-ip") || null;
  return { userAgent: h.get("user-agent"), ip };
}

export type CreateUserResult =
  | { ok: true; user: { id: string; email: string; isAdmin: boolean } }
  | { ok: false; error: string };

/** Create a user with a hashed password. Fails softly on a missing DB. */
export async function createUser(
  email: string,
  password: string,
): Promise<CreateUserResult> {
  const db = getDb();
  if (!db) {
    return { ok: false, error: "Accounts need a database (DATABASE_URL is not set)." };
  }
  try {
    const [row] = await db
      .insert(users)
      .values({ email: email.trim().toLowerCase(), passwordHash: await hashPassword(password) })
      .returning({ id: users.id, email: users.email, isAdmin: users.isAdmin });
    return { ok: true, user: row };
  } catch {
    // Most likely the unique-email constraint.
    return { ok: false, error: "That email is already registered." };
  }
}

/** Return the user iff the email exists and the password matches. */
export async function verifyCredentials(
  email: string,
  password: string,
): Promise<{ id: string; email: string; isAdmin: boolean } | null> {
  const db = getDb();
  if (!db) return null;
  const [row] = await db
    .select()
    .from(users)
    .where(eq(users.email, email.trim().toLowerCase()))
    .limit(1);
  if (!row || !(await verifyPassword(password, row.passwordHash))) return null;
  return { id: row.id, email: row.email, isAdmin: row.isAdmin };
}

/** Create a session row and set its token as an httpOnly cookie. */
export async function createSession(userId: string): Promise<void> {
  const db = getDb();
  if (!db) return;
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_MS);
  const meta = await requestMeta();
  await db.insert(sessions).values({
    userId,
    tokenHash: sha256(token),
    expiresAt,
    userAgent: meta.userAgent,
    ip: meta.ip,
  });

  // Cheap, no-infra expired-session cleanup: on ~2% of new logins, sweep
  // expired rows. Not a substitute for the dedicated /api/cron/cleanup-sessions
  // endpoint (which a real scheduler should call regularly), but keeps the
  // table bounded even if nothing is wired up to call it.
  if (Math.random() < 0.02) void cleanupExpiredSessions();

  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

/** Resolve the logged-in user (and their current session id) from the cookie, or null. */
export async function getCurrentUser(): Promise<AuthUser | null> {
  const db = getDb();
  if (!db) return null;
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const [row] = await db
    .select({
      id: users.id,
      email: users.email,
      isAdmin: users.isAdmin,
      sessionId: sessions.id,
    })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(and(eq(sessions.tokenHash, sha256(token)), gt(sessions.expiresAt, new Date())))
    .limit(1);
  return row ?? null;
}

/** Delete the current session and clear the cookie. */
export async function logout(): Promise<void> {
  const db = getDb();
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token && db) {
    try {
      await db.delete(sessions).where(eq(sessions.tokenHash, sha256(token)));
    } catch {
      /* best-effort */
    }
  }
  jar.set(SESSION_COOKIE, "", { path: "/", maxAge: 0 });
}

/** A user's active sessions for display in Settings, most recent first. Never throws. */
export async function listSessions(userId: string): Promise<SessionRow[]> {
  const db = getDb();
  if (!db) return [];
  try {
    return await db
      .select()
      .from(sessions)
      .where(and(eq(sessions.userId, userId), gt(sessions.expiresAt, new Date())))
      .orderBy(desc(sessions.createdAt));
  } catch (err) {
    console.error("listSessions failed:", err);
    return [];
  }
}

/** Revoke one of the user's own sessions by id. Scoped so a user can't revoke another's. */
export async function revokeSession(userId: string, sessionId: string): Promise<boolean> {
  const db = getDb();
  if (!db) return false;
  try {
    const deleted = await db
      .delete(sessions)
      .where(and(eq(sessions.id, sessionId), eq(sessions.userId, userId)))
      .returning({ id: sessions.id });
    return deleted.length > 0;
  } catch (err) {
    console.error("revokeSession failed:", err);
    return false;
  }
}

/**
 * Revoke every session for a user except (optionally) the one given —
 * "log out all other devices" when `exceptSessionId` is set, "log out
 * everywhere" when omitted. Never throws.
 */
export async function revokeOtherSessions(
  userId: string,
  exceptSessionId?: string,
): Promise<boolean> {
  const db = getDb();
  if (!db) return false;
  try {
    await db
      .delete(sessions)
      .where(
        exceptSessionId
          ? and(eq(sessions.userId, userId), ne(sessions.id, exceptSessionId))
          : eq(sessions.userId, userId),
      );
    return true;
  } catch (err) {
    console.error("revokeOtherSessions failed:", err);
    return false;
  }
}

/** Delete every expired session row. Never throws. Returns the count removed. */
export async function cleanupExpiredSessions(): Promise<number> {
  const db = getDb();
  if (!db) return 0;
  try {
    const deleted = await db
      .delete(sessions)
      .where(lt(sessions.expiresAt, new Date()))
      .returning({ id: sessions.id });
    return deleted.length;
  } catch (err) {
    console.error("cleanupExpiredSessions failed:", err);
    return 0;
  }
}
