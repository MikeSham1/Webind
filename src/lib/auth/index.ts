import { createHash, randomBytes } from "node:crypto";
import { cookies, headers } from "next/headers";
import { and, desc, eq, gt, isNotNull, lt, ne } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { reportRequests, sessions, users, type SessionRow } from "@/lib/db/schema";
import { cancelSubscription } from "@/lib/billing/stripe";
import { getSubscription } from "@/lib/billing/store";
import { hashPassword, verifyPassword } from "./password";

const SESSION_COOKIE = "wb_session";
const SESSION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export interface AuthUser {
  id: string;
  email: string;
  isAdmin: boolean;
  /** The current session's row id — lets callers mark "this device" in a session list. */
  sessionId: string;
  /** Null when unverified. Informational only — never gates access. */
  emailVerifiedAt: Date | null;
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

// A fixed, lazily-computed hash to verify against when no account matches —
// see the comment in verifyCredentials for why.
let dummyPasswordHash: Promise<string> | null = null;
function getDummyPasswordHash(): Promise<string> {
  if (!dummyPasswordHash) dummyPasswordHash = hashPassword(randomBytes(32).toString("hex"));
  return dummyPasswordHash;
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
  // Run the same scrypt cost whether or not the account exists — otherwise an
  // unregistered email returns immediately while a registered one pays for a
  // real scrypt derivation first, and that latency gap enumerates accounts.
  // requestPasswordResetAction already treats this as a real threat; login
  // gets the same treatment here.
  const valid = await verifyPassword(password, row?.passwordHash ?? (await getDummyPasswordHash()));
  if (!row || !valid) return null;
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
      emailVerifiedAt: users.emailVerifiedAt,
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

/**
 * Permanently delete a user's account after re-verifying their password (a
 * hijacked or CSRF'd session cookie alone must not be enough to destroy the
 * account). Cascades via FK `onDelete` rules to sessions, reset/verification
 * tokens, WordPress/GitHub connections, and publication records.
 *
 * A live Stripe subscription is canceled FIRST, before anything is deleted —
 * once the account and its local subscription row are gone, the customer can
 * no longer log in or reach the billing portal, so an uncanceled subscription
 * would keep charging someone with no way to stop it. If Stripe can't be
 * reached, the account is left intact (nothing deleted) rather than deleting
 * it and orphaning the subscription — the error explains why and the user
 * can retry.
 *
 * Report requests and content drafts are NOT deleted — their `userId` is set
 * to null instead (same schema rule an anonymous, logged-out run already
 * uses), so they keep existing as anonymized rows rather than being erased.
 * "Anonymized" has to actually mean that, though: a report's `email` column
 * (the address someone left in the lead-capture form) is direct PII that
 * survives a bare userId->null unlink, so it's explicitly cleared here too —
 * otherwise the row still names exactly who ran it. The audit log similarly
 * keeps its rows with `actorUserId` set to null, since it is an append-only
 * record of writes to external sites, not of the account that made them.
 * Also clears the caller's own session cookie.
 */
export async function deleteAccount(
  userId: string,
  password: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const db = getDb();
  if (!db) {
    return { ok: false, error: "Accounts need a database (DATABASE_URL is not set)." };
  }
  const [row] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!row || !(await verifyPassword(password, row.passwordHash))) {
    return { ok: false, error: "Incorrect password." };
  }

  const subscription = await getSubscription(userId);
  if (subscription?.stripeSubscriptionId) {
    const canceled = await cancelSubscription(subscription.stripeSubscriptionId);
    if (!canceled.ok) {
      return {
        ok: false,
        error: `Couldn't cancel your subscription (${canceled.error}) — your account was NOT deleted. Try again, or contact support.`,
      };
    }
  }

  // Redact the identifying email BEFORE the delete cascades userId to null —
  // afterward there'd be no way to distinguish this user's now-anonymous
  // rows from any other anonymous run's.
  await db
    .update(reportRequests)
    .set({ email: null })
    .where(and(eq(reportRequests.userId, userId), isNotNull(reportRequests.email)));

  await db.delete(users).where(eq(users.id, userId));
  await logout();
  return { ok: true };
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
