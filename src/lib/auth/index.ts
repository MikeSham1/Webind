import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { and, eq, gt } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { sessions, users } from "@/lib/db/schema";
import { hashPassword, verifyPassword } from "./password";

const SESSION_COOKIE = "wb_session";
const SESSION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export interface AuthUser {
  id: string;
  email: string;
  isAdmin: boolean;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export type CreateUserResult =
  | { ok: true; user: AuthUser }
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
): Promise<AuthUser | null> {
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
  await db.insert(sessions).values({ userId, tokenHash: sha256(token), expiresAt });

  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

/** Resolve the logged-in user from the session cookie, or null. */
export async function getCurrentUser(): Promise<AuthUser | null> {
  const db = getDb();
  if (!db) return null;
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const [row] = await db
    .select({ id: users.id, email: users.email, isAdmin: users.isAdmin })
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
