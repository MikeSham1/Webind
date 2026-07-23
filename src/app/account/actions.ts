"use server";

import { redirect } from "next/navigation";
import { createSession, createUser, logout, verifyCredentials } from "@/lib/auth";
import type { AuthState } from "./state";

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export async function signupAction(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
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
