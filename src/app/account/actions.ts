"use server";

import { redirect } from "next/navigation";
import { createSession, createUser, logout, verifyCredentials } from "@/lib/auth";
import { checkRateLimit, formatRetryAfter } from "@/lib/rateLimit";
import { getClientIp } from "@/lib/requestIp";
import type { AuthState } from "./state";

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
