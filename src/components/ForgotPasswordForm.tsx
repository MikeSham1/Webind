"use client";

import Link from "next/link";
import { useActionState } from "react";
import { requestPasswordResetAction } from "@/app/account/actions";
import { initialForgotPasswordState } from "@/app/account/state";

const inputClass =
  "mt-1.5 w-full rounded-lg border border-line-strong bg-paper px-3 py-2.5 font-sans text-[15px] text-ink placeholder:text-muted/60 focus-visible:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft";

export default function ForgotPasswordForm() {
  const [state, formAction, isPending] = useActionState(
    requestPasswordResetAction,
    initialForgotPasswordState,
  );

  return (
    <div className="w-full max-w-sm">
      <p className="font-mono text-xs uppercase tracking-[0.2em] text-accent">
        Reset password
      </p>
      <h1 className="mt-2 font-display text-3xl font-semibold text-ink">
        Forgot your password?
      </h1>
      <p className="mt-2 text-sm text-muted">
        Enter your email and, if it&apos;s registered, we&apos;ll send a reset link.
      </p>

      {state.status === "requested" ? (
        <p
          role="status"
          className="mt-6 rounded-2xl border border-line bg-surface p-6 text-[15px] text-ink"
        >
          If that email is registered, a reset link is on its way. Check your
          inbox — it&apos;s valid for 1 hour.
        </p>
      ) : (
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
          <button
            type="submit"
            disabled={isPending}
            className="inline-flex h-11 w-full items-center justify-center rounded-full bg-accent px-6 font-sans text-[15px] font-semibold text-accent-ink transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-70"
          >
            {isPending ? "…" : "Send reset link"}
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
