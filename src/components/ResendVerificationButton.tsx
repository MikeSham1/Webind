"use client";

import { useActionState } from "react";
import { resendVerificationEmailAction } from "@/app/account/actions";
import { initialResendVerificationState } from "@/app/account/state";

export default function ResendVerificationButton() {
  const [state, formAction, isPending] = useActionState(
    resendVerificationEmailAction,
    initialResendVerificationState,
  );

  if (state.status === "sent") {
    return <p className="text-sm font-medium text-good">Sent — check your inbox.</p>;
  }

  return (
    <form action={formAction} className="flex flex-col items-end gap-1">
      <button
        type="submit"
        disabled={isPending}
        className="whitespace-nowrap font-mono text-xs uppercase tracking-[0.14em] text-accent hover:underline disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isPending ? "Sending…" : "Resend verification email"}
      </button>
      {state.status === "error" && (
        <p role="alert" className="text-xs text-bad">
          {state.error}
        </p>
      )}
    </form>
  );
}
