"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  createSession,
  createUser,
  deleteAccount,
  getCurrentUser,
  logout,
  verifyCredentials,
} from "@/lib/auth";
import { consumePasswordResetToken, requestPasswordReset } from "@/lib/auth/passwordReset";
import {
  consumeEmailVerificationToken,
  sendVerificationEmail,
} from "@/lib/auth/emailVerification";
import { checkRateLimit, formatRetryAfter } from "@/lib/rateLimit";
import { getClientIp } from "@/lib/requestIp";
import { getBaseUrl } from "@/lib/baseUrl";
import { claimPendingReport, PENDING_REPORT_COOKIE } from "@/lib/leads";
import { planById } from "@/lib/billing/plans";
import type {
  AuthState,
  DeleteAccountState,
  ForgotPasswordState,
  ResendVerificationState,
  ResetPasswordState,
  VerifyEmailState,
} from "./state";

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/**
 * Where login/signup send someone afterward, instead of always /studio.
 * Deliberately an allowlist of exact internal paths, not "anything that
 * doesn't start with //" or similar — `next` comes from a query param a link
 * controls, so validating it loosely is an open-redirect risk the moment
 * someone crafts a link with next=https://evil.example.
 */
const NEXT_ALLOWLIST = new Set(["/pricing", "/dashboard", "/studio"]);

/** The validated `next` destination from a login/signup form, or null if absent/not allowlisted. */
function resolveNext(formData: FormData): string | null {
  const next = String(formData.get("next") ?? "");
  return NEXT_ALLOWLIST.has(next) ? next : null;
}

/**
 * Claim a signed-out visitor's just-run report onto the account they just
 * created or signed into — "report, account, same report" instead of a blank
 * dashboard — and clear the claim cookie either way (a stale claim attempt
 * against a report someone else already claimed shouldn't linger).
 */
async function claimPendingReportForUser(userId: string): Promise<string | null> {
  const jar = await cookies();
  const pendingReportId = jar.get(PENDING_REPORT_COOKIE)?.value;
  if (!pendingReportId) return null;
  jar.set(PENDING_REPORT_COOKIE, "", { path: "/", maxAge: 0 });
  const claimed = await claimPendingReport(userId, pendingReportId);
  return claimed ? pendingReportId : null;
}

/**
 * Resolve and perform the post-auth redirect, honoring (in order): an
 * allowlisted `next` (carrying the selected plan along if headed to
 * /pricing), then a just-claimed report, then the default landing page.
 * Always redirects — never returns.
 */
function redirectAfterAuth(formData: FormData, claimedReportId: string | null): never {
  const next = resolveNext(formData);
  if (next === "/pricing") {
    const planId = String(formData.get("plan") ?? "");
    redirect(planById(planId) ? `/pricing?plan=${planId}` : "/pricing");
  }
  if (next) redirect(next);
  if (claimedReportId) redirect(`/dashboard/reports/${claimedReportId}`);
  // Content Studio is the portal's front page — it's where a signed-in user
  // actually does work. The dashboard stays one click away in the nav.
  redirect("/studio");
}

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
  const confirmPassword = String(formData.get("confirmPassword") ?? "");
  const termsAccepted = formData.get("termsAccepted") === "accepted";

  if (!EMAIL_RE.test(email)) {
    return { status: "error", error: "Enter a valid email address.", email, termsAccepted };
  }
  if (password.length < 8) {
    return {
      status: "error",
      error: "Password must be at least 8 characters.",
      email,
      termsAccepted,
    };
  }
  // Checked server-side too: a client-only match check is trivially bypassed.
  if (password !== confirmPassword) {
    return {
      status: "error",
      error: "The two passwords don't match.",
      email,
      termsAccepted,
    };
  }
  if (!termsAccepted) {
    return {
      status: "error",
      error: "You must agree to the Terms of Service and acknowledge the Privacy Policy to create an account.",
      email,
      termsAccepted,
    };
  }

  const result = await createUser(email, password);
  if (!result.ok) return { status: "error", error: result.error, email, termsAccepted };

  await createSession(result.user.id);
  // Best-effort and never throws; awaited (not fire-and-forget) so it isn't
  // left racing the redirect that follows.
  await sendVerificationEmail(result.user.id, result.user.email, await getBaseUrl());
  const claimedReportId = await claimPendingReportForUser(result.user.id);
  redirectAfterAuth(formData, claimedReportId);
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
    return { status: "error", error: formatRetryAfter(retryAfterMs), email };
  }

  const password = String(formData.get("password") ?? "");
  const user = await verifyCredentials(email, password);
  if (!user) return { status: "error", error: "Invalid email or password.", email };

  await createSession(user.id);
  const claimedReportId = await claimPendingReportForUser(user.id);
  redirectAfterAuth(formData, claimedReportId);
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
export async function resendVerificationEmailAction(
  _prev: ResendVerificationState,
  _formData: FormData,
): Promise<ResendVerificationState> {
  const user = await getCurrentUser();
  if (!user) return { status: "error", error: "Log in to resend your verification email." };
  if (user.emailVerifiedAt) return { status: "sent" }; // already verified — nothing left to do

  const ip = await getClientIp();
  const limit = checkRateLimit(`resend-verify:${user.id}:${ip}`, 60 * 60 * 1000, 5);
  if (!limit.allowed) {
    return { status: "error", error: formatRetryAfter(limit.retryAfterMs) };
  }

  const delivered = await sendVerificationEmail(user.id, user.email, await getBaseUrl());
  if (!delivered) {
    return { status: "error", error: "Couldn't send the verification email right now — try again shortly." };
  }
  return { status: "sent" };
}

/**
 * Permanently delete the signed-in user's account. Requires the current
 * password so a hijacked session alone can't destroy it. Irreversible: see
 * deleteAccount() for exactly what cascades.
 */
export async function deleteAccountAction(
  _prev: DeleteAccountState,
  formData: FormData,
): Promise<DeleteAccountState> {
  const user = await getCurrentUser();
  if (!user) return { status: "error", error: "Log in to delete your account." };

  const ip = await getClientIp();
  const limit = checkRateLimit(`delete-account:${user.id}:${ip}`, 60 * 60 * 1000, 5);
  if (!limit.allowed) {
    return { status: "error", error: formatRetryAfter(limit.retryAfterMs) };
  }

  const password = String(formData.get("password") ?? "");
  const result = await deleteAccount(user.id, password);
  if (!result.ok) return { status: "error", error: result.error };
  redirect("/");
}
