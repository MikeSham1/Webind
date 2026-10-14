"use client";

import { useState, useActionState } from "react";
import { deleteAccountAction } from "@/app/account/actions";
import { initialDeleteAccountState } from "@/app/account/state";
import PasswordInput from "@/components/PasswordInput";

export default function DeleteAccountForm() {
  const [confirming, setConfirming] = useState(false);
  const [state, formAction, isPending] = useActionState(
    deleteAccountAction,
    initialDeleteAccountState,
  );

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="font-mono text-xs uppercase tracking-[0.14em] text-bad hover:underline"
      >
        Delete my account
      </button>
    );
  }

  return (
    <form
      action={formAction}
      className="space-y-4 rounded-2xl border border-bad/40 bg-surface p-6"
    >
      <p className="text-[15px] leading-relaxed text-ink">
        This permanently deletes your account, sessions, and WordPress/GitHub
        connections. Reports and drafts you created are anonymized (kept, but
        no longer tied to your account) rather than deleted, the same as a
        logged-out run. It does not un-publish anything already live on your
        own site or repo. This can&apos;t be undone.
      </p>
      <label className="block">
        <span className="font-sans text-sm font-medium text-ink">
          Confirm your password
        </span>
        <PasswordInput name="password" autoComplete="current-password" required />
      </label>

      {state.status === "error" && (
        <p role="alert" className="text-sm text-bad">
          {state.error}
        </p>
      )}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={isPending}
          className="inline-flex h-11 items-center justify-center rounded-full bg-bad px-6 font-sans text-[15px] font-semibold text-white transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-70"
        >
          {isPending ? "Deleting…" : "Permanently delete my account"}
        </button>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          className="font-sans text-sm font-medium text-muted hover:text-ink"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
