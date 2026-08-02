"use client";

import Link from "next/link";
import { useActionState } from "react";
import { loginAction, signupAction } from "@/app/account/actions";
import { initialAuthState } from "@/app/account/state";

const inputClass =
  "mt-1.5 w-full rounded-lg border border-line-strong bg-paper px-3 py-2.5 font-sans text-[15px] text-ink placeholder:text-muted/60 focus-visible:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft";

export default function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const action = mode === "login" ? loginAction : signupAction;
  const [state, formAction, isPending] = useActionState(action, initialAuthState);

  const isLogin = mode === "login";

  return (
    <div className="w-full max-w-sm">
      <p className="font-mono text-xs uppercase tracking-[0.2em] text-accent">
        {isLogin ? "Welcome back" : "Get started"}
      </p>
      <h1 className="mt-2 font-display text-3xl font-semibold text-ink">
        {isLogin ? "Log in" : "Create your account"}
      </h1>
      <p className="mt-2 text-sm text-muted">
        {isLogin
          ? "Pick up where you left off."
          : "Track your authority scores and content drafts in one place."}
      </p>

      <form
        action={formAction}
        className="mt-6 space-y-4 rounded-2xl border border-line bg-surface p-6"
      >
        <label className="block">
          <span className="font-sans text-sm font-medium text-ink">Email</span>
          <input
            name="email"
            type="email"
            autoComplete="email"
            required
            className={inputClass}
          />
        </label>
        <label className="block">
          <span className="font-sans text-sm font-medium text-ink">Password</span>
          <input
            name="password"
            type="password"
            autoComplete={isLogin ? "current-password" : "new-password"}
            required
            minLength={isLogin ? undefined : 8}
            className={inputClass}
          />
          {!isLogin && (
            <span className="mt-1 block text-xs text-muted">
              At least 8 characters.
            </span>
          )}
        </label>

        {state.status === "error" && (
          <p role="alert" className="text-sm text-bad">
            {state.error}
          </p>
        )}

        <button
          type="submit"
          disabled={isPending}
          className="inline-flex h-11 w-full items-center justify-center rounded-full bg-accent px-6 font-sans text-[15px] font-semibold text-accent-ink transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-70"
        >
          {isPending ? "…" : isLogin ? "Log in" : "Sign up"}
        </button>
      </form>

      <p className="mt-5 text-center text-sm text-muted">
        {isLogin ? (
          <>
            No account?{" "}
            <Link href="/signup" className="font-medium text-accent hover:underline">
              Sign up
            </Link>
          </>
        ) : (
          <>
            Already have one?{" "}
            <Link href="/login" className="font-medium text-accent hover:underline">
              Log in
            </Link>
          </>
        )}
      </p>
    </div>
  );
}
