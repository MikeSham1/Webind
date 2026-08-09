"use client";

import Link from "next/link";
import { useActionState, useEffect } from "react";
import { verifyEmailAction } from "@/app/account/actions";
import { initialVerifyEmailState } from "@/app/account/state";

export default function VerifyEmailForm({ token }: { token: string }) {
  const [state, formAction, isPending] = useActionState(
    verifyEmailAction,
    initialVerifyEmailState,
  );

  // Submits automatically — this page exists only because someone clicked a
  // link, there's no reason to make them click a second button too.
  useEffect(() => {
    if (token) {
      const fd = new FormData();
      fd.set("token", token);
      formAction(fd);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  return (
    <div className="w-full max-w-sm text-center">
      <p className="font-mono text-xs uppercase tracking-[0.2em] text-accent">
        Email verification
      </p>
      <h1 className="mt-2 font-display text-3xl font-semibold text-ink">
        Verifying your email
      </h1>

      <div className="mt-6 rounded-2xl border border-line bg-surface p-6">
        {!token ? (
          <p className="text-sm text-bad">
            This link is missing its token. Use the link from your email, or
            request a new one from your dashboard.
          </p>
        ) : isPending ? (
          <p className="text-[15px] text-muted">One moment…</p>
        ) : state.status === "done" ? (
          <p role="status" className="text-[15px] text-good">
            Your email is verified. Thanks!
          </p>
        ) : state.status === "error" ? (
          <p role="alert" className="text-sm text-bad">
            {state.error}
          </p>
        ) : (
          <p className="text-[15px] text-muted">One moment…</p>
        )}
      </div>

      <p className="mt-5 text-sm text-muted">
        <Link href="/dashboard" className="font-medium text-accent hover:underline">
          Go to dashboard
        </Link>
      </p>
    </div>
  );
}
