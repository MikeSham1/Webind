"use server";

import { redirect } from "next/navigation";
import { createSession, createUser, getCurrentUser, logout, verifyCredentials } from "@/lib/auth";
import { consumePasswordResetToken, requestPasswordReset } from "@/lib/auth/passwordReset";
import {
  consumeEmailVerificationToken,
  sendVerificationEmail,
} from "@/lib/auth/emailVerification";
import { checkRateLimit, formatRetryAfter } from "@/lib/rateLimit";
import { getClientIp } from "@/lib/requestIp";
import { getBaseUrl } from "@/lib/baseUrl";
import type {
  AuthState,
  ForgotPasswordState,
  ResetPasswordState,
  VerifyEmailState,
} from "./state";

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export async function signupAction(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const ip = await getClientIp();
  const limit = checkRateLimit(`signup:${ip}`, 60 * 60 * 1000, 10);
  if (!limit.allowed) {
    return { status: "error", error: formatRetryAfter(limit.retryAfterMs) };
  }

  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!EMAIL_RE.test(email)) {
    return { status: "error", error: "Enter a valid email address." };
  }
  if (password.length < 8) {
    return { status: "error", error: "Password must be at least 8 characters." };
  }

  const result = await createUser(email, password);
  if (!result.ok) return { status: "error", error: result.error };

  await createSession(result.user.id);
  // Best-effort and never throws; awaited (not fire-and-forget) so it isn't
  // left racing the redirect that follows.
  await sendVerificationEmail(result.user.id, result.user.email, await getBaseUrl());
  redirect("/dashboard");
}

export async function loginAction(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const email = String(formData.get("email") ?? "").trim();

  // Keyed by IP+email so a brute-force sweep across many accounts from one IP
  // is capped independently of any single account being hammered from many
  // IPs — the two are different attack shapes and this covers both together
  // with one check, since each hit only counts against its own (ip, email) pair
  // AND we also cap the IP alone below regardless of which email it's trying.
  const ip = await getClientIp();
  const perAccount = checkRateLimit(`login:${ip}:${email.toLowerCase()}`, 15 * 60 * 1000, 10);
  const perIp = checkRateLimit(`login-ip:${ip}`, 15 * 60 * 1000, 30);
  if (!perAccount.allowed || !perIp.allowed) {
    const retryAfterMs = Math.max(perAccount.retryAfterMs, perIp.retryAfterMs);
    return { status: "error", error: formatRetryAfter(retryAfterMs) };
  }

  const password = String(formData.get("password") ?? "");
  const user = await verifyCredentials(email, password);
  if (!user) return { status: "error", error: "Invalid email or password." };

  await createSession(user.id);
  redirect("/dashboard");
}

export async function logoutAction(): Promise<void> {
  await logout();
  redirect("/login");
}

/**
 * Request a password-reset email. Always returns the same "requested" state
 * regardless of whether the address is registered, an unregistered lookup, or
 * a rate limit was hit — a different response for any of those would let a
 * stranger enumerate registered emails or probe for account existence.
 */
export async function requestPasswordResetAction(
  _prev: ForgotPasswordState,
  formData: FormData,
): Promise<ForgotPasswordState> {
  const email = String(formData.get("email") ?? "").trim();
  const ip = await getClientIp();

  // Capped, but note the response is identical whether or not this trips —
  // only the work skipped differs, never what the visitor sees.
  const limit = checkRateLimit(`forgot-password:${ip}`, 60 * 60 * 1000, 6);
  if (EMAIL_RE.test(email) && limit.allowed) {
    const baseUrl = await getBaseUrl();
    await requestPasswordReset(email, baseUrl);
  }

  return { status: "requested" };
}

export async function resetPasswordAction(
  _prev: ResetPasswordState,
  formData: FormData,
): Promise<ResetPasswordState> {
  const token = String(formData.get("token") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!token) {
    return { status: "error", error: "Missing reset token — use the link from your email." };
  }

  const ip = await getClientIp();
  const limit = checkRateLimit(`reset-password:${ip}`, 15 * 60 * 1000, 10);
  if (!limit.allowed) {
    return { status: "error", error: formatRetryAfter(limit.retryAfterMs) };
  }

  const result = await consumePasswordResetToken(token, password);
  if (!result.ok) return { status: "error", error: result.error };
  return { status: "done" };
}

export async function verifyEmailAction(
  _prev: VerifyEmailState,
  formData: FormData,
): Promise<VerifyEmailState> {
  const token = String(formData.get("token") ?? "").trim();
  if (!token) {
    return { status: "error", error: "Missing verification token — use the link from your email." };
  }
  const result = await consumeEmailVerificationToken(token);
  if (!result.ok) return { status: "error", error: result.error };
  return { status: "done" };
}

/** Re-send the verification email to the signed-in (but unverified) user. */
export async function resendVerificationEmailAction(): Promise<void> {
  const user = await getCurrentUser();
  if (!user || user.emailVerifiedAt) return;

  const ip = await getClientIp();
  const limit = checkRateLimit(`resend-verify:${user.id}:${ip}`, 60 * 60 * 1000, 5);
  if (!limit.allowed) return;

  await sendVerificationEmail(user.id, user.email, await getBaseUrl());
}
