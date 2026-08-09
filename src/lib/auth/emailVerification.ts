import { createHash, randomBytes } from "node:crypto";
import { and, eq, isNull, lt } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { emailVerificationTokens, users } from "@/lib/db/schema";
import { sendEmail } from "@/lib/email";
import { logInfo } from "@/lib/log";

const TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/**
 * Send a verification email for `userId`. Purely informational (see the
 * `emailVerifiedAt` column comment) — never blocks signup or login, and
 * degrades to a server-side log when no email provider is configured, same
 * pattern as password reset. Never throws.
 */
export async function sendVerificationEmail(
  userId: string,
  email: string,
  baseUrl: string,
): Promise<void> {
  const db = getDb();
  if (!db) return;

  try {
    await db
      .delete(emailVerificationTokens)
      .where(and(eq(emailVerificationTokens.userId, userId), lt(emailVerificationTokens.expiresAt, new Date())));

    const token = randomBytes(32).toString("hex");
    await db.insert(emailVerificationTokens).values({
      userId,
      tokenHash: sha256(token),
      expiresAt: new Date(Date.now() + TOKEN_TTL_MS),
    });

    const verifyUrl = `${baseUrl}/verify-email?token=${token}`;
    const sent = await sendEmail({
      to: email,
      subject: "Verify your WeBind email",
      text: `Confirm this is your email address (valid for 24 hours): ${verifyUrl}`,
    });

    if (!sent.delivered) {
      logInfo("email_verification.link_not_emailed", { userId, reason: sent.reason });
    }
  } catch (err) {
    console.error("sendVerificationEmail failed:", err);
  }
}

export type ConsumeVerificationResult = { ok: true } | { ok: false; error: string };

/** Validate a verification token and mark the account verified. */
export async function consumeEmailVerificationToken(
  token: string,
): Promise<ConsumeVerificationResult> {
  const db = getDb();
  if (!db) return { ok: false, error: "Email verification needs a database (DATABASE_URL is not set)." };

  try {
    const [row] = await db
      .select()
      .from(emailVerificationTokens)
      .where(eq(emailVerificationTokens.tokenHash, sha256(token)))
      .limit(1);

    if (!row || row.usedAt !== null || row.expiresAt.getTime() < Date.now()) {
      return { ok: false, error: "That verification link is invalid or has expired." };
    }

    // Same atomic-claim pattern as password reset: mark used BEFORE writing,
    // so two concurrent visits to the same link can't both "win".
    const claimed = await db
      .update(emailVerificationTokens)
      .set({ usedAt: new Date() })
      .where(and(eq(emailVerificationTokens.id, row.id), isNull(emailVerificationTokens.usedAt)))
      .returning({ id: emailVerificationTokens.id });
    if (claimed.length === 0) {
      return { ok: false, error: "That verification link is invalid or has expired." };
    }

    await db.update(users).set({ emailVerifiedAt: new Date() }).where(eq(users.id, row.userId));
    return { ok: true };
  } catch (err) {
    console.error("consumeEmailVerificationToken failed:", err);
    return { ok: false, error: "Something went wrong — try again." };
  }
}
