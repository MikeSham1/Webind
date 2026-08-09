import { createHash, randomBytes } from "node:crypto";
import { and, eq, isNull, lt } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { passwordResetTokens, users } from "@/lib/db/schema";
import { hashPassword } from "./password";
import { revokeOtherSessions } from "./index";
import { sendEmail } from "@/lib/email";
import { logInfo } from "@/lib/log";

const TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/**
 * Request a password reset for `email`. ALWAYS completes the same way whether
 * or not the address is registered — the caller (the server action) must show
 * an identical message either way, so this deliberately returns nothing to
 * decide on. Never throws.
 *
 * When no email is registered to that address, this is a silent no-op (aside
 * from the constant-shape work below) so a stranger can't use "did I get an
 * error" to enumerate accounts.
 */
export async function requestPasswordReset(email: string, baseUrl: string): Promise<void> {
  const db = getDb();
  if (!db) return;

  try {
    const [user] = await db
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(eq(users.email, email.trim().toLowerCase()))
      .limit(1);
    if (!user) return;

    // Bound growth per-user rather than running a global sweep.
    await db
      .delete(passwordResetTokens)
      .where(and(eq(passwordResetTokens.userId, user.id), lt(passwordResetTokens.expiresAt, new Date())));

    const token = randomBytes(32).toString("hex");
    await db.insert(passwordResetTokens).values({
      userId: user.id,
      tokenHash: sha256(token),
      expiresAt: new Date(Date.now() + TOKEN_TTL_MS),
    });

    const resetUrl = `${baseUrl}/reset-password?token=${token}`;
    const sent = await sendEmail({
      to: user.email,
      subject: "Reset your WeBind password",
      text:
        `We received a request to reset your WeBind password.\n\n` +
        `Reset it here (valid for 1 hour): ${resetUrl}\n\n` +
        `If you didn't request this, you can ignore this email.`,
    });

    if (!sent.delivered) {
      // No email provider configured (or the send failed) -- log the link so
      // an operator can retrieve it from server logs in an emergency. NEVER
      // returned to the HTTP response; only reachable by whoever can read
      // this process's logs.
      logInfo("password_reset.link_not_emailed", {
        userId: user.id,
        reason: sent.reason,
      });
    }
  } catch (err) {
    console.error("requestPasswordReset failed:", err);
  }
}

export type ConsumeResetResult = { ok: true } | { ok: false; error: string };

/** Validate a reset token and set the new password. Revokes all sessions on success. */
export async function consumePasswordResetToken(
  token: string,
  newPassword: string,
): Promise<ConsumeResetResult> {
  const db = getDb();
  if (!db) return { ok: false, error: "Password reset needs a database (DATABASE_URL is not set)." };
  if (newPassword.length < 8) {
    return { ok: false, error: "Password must be at least 8 characters." };
  }

  try {
    const [row] = await db
      .select()
      .from(passwordResetTokens)
      .where(eq(passwordResetTokens.tokenHash, sha256(token)))
      .limit(1);

    if (!row || row.usedAt !== null || row.expiresAt.getTime() < Date.now()) {
      return { ok: false, error: "That reset link is invalid or has expired. Request a new one." };
    }

    // Atomically claim the token (WHERE usedAt IS NULL) BEFORE touching the
    // password, so two concurrent submits of the same link can't both
    // succeed — whichever loses this race sees 0 rows updated and stops here,
    // rather than both racing to write the password and only one "winning"
    // the marked-used bookkeeping after the fact.
    const claimed = await db
      .update(passwordResetTokens)
      .set({ usedAt: new Date() })
      .where(and(eq(passwordResetTokens.id, row.id), isNull(passwordResetTokens.usedAt)))
      .returning({ id: passwordResetTokens.id });
    if (claimed.length === 0) {
      return { ok: false, error: "That reset link is invalid or has expired. Request a new one." };
    }

    await db
      .update(users)
      .set({ passwordHash: await hashPassword(newPassword) })
      .where(eq(users.id, row.userId));

    // A password reset is a strong signal something was wrong; terminate every
    // existing session so a stolen cookie doesn't survive the reset.
    await revokeOtherSessions(row.userId);

    return { ok: true };
  } catch (err) {
    console.error("consumePasswordResetToken failed:", err);
    return { ok: false, error: "Something went wrong — try again." };
  }
}
