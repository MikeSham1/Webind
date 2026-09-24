"use client";

import Link from "next/link";
import { useActionState } from "react";
import { resetPasswordAction } from "@/app/account/actions";
import { initialResetPasswordState } from "@/app/account/state";

const inputClass =
  "mt-1.5 w-full rounded-lg border border-line-strong bg-paper px-3 py-2.5 font-sans text-[15px] text-ink placeholder:text-muted/60 focus-visible:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft";

export default function ResetPasswordForm({ token }: { token: string }) {
  const [state, formAction, isPending] = useActionState(
    resetPasswordAction,
    initialResetPasswordState,
  );

  return (
    <div className="w-full max-w-sm">
      <Link
        href="/"
        className="font-mono text-xs uppercase tracking-[0.16em] text-muted hover:text-accent"
      >
        ← WeBind Design
      </Link>
      <p className="mt-6 font-mono text-xs uppercase tracking-[0.2em] text-accent">
        Reset password
      </p>
      <h1 className="mt-2 font-display text-3xl font-semibold text-ink">
        Choose a new password
      </h1>

      {state.status === "done" ? (
        <div className="mt-6 rounded-2xl border border-line bg-surface p-6">
          <p role="status" className="text-[15px] text-ink">
            Your password has been reset, and every other device has been
            signed out for safety.
          </p>
          <Link
            href="/login"
            className="mt-4 inline-flex h-11 w-full items-center justify-center rounded-full bg-accent px-6 font-sans text-[15px] font-semibold text-accent-ink transition-colors hover:bg-accent-hover"
          >
            Log in
          </Link>
        </div>
      ) : !token ? (
        <p className="mt-6 rounded-2xl border border-bad/40 bg-surface p-6 text-sm text-bad">
          This reset link is missing its token. Use the link from your email,
          or{" "}
          <Link href="/forgot-password" className="font-medium underline">
            request a new one
          </Link>
          .
        </p>
      ) : (
        <form
          action={formAction}
          className="mt-6 space-y-4 rounded-2xl border border-line bg-surface p-6"
        >
          <input type="hidden" name="token" value={token} />
          <label className="block">
            <span className="font-sans text-sm font-medium text-ink">New password</span>
            <input
              name="password"
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              className={inputClass}
            />
            <span className="mt-1 block text-xs text-muted">At least 8 characters.</span>
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
            {isPending ? "…" : "Reset password"}
          </button>
        </form>
      )}

      <p className="mt-5 text-center text-sm text-muted">
        <Link href="/login" className="font-medium text-accent hover:underline">
          Back to log in
        </Link>
      </p>
    </div>
  );
}
