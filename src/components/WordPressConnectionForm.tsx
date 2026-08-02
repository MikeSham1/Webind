"use client";

import { useActionState } from "react";
import {
  connectWordPressAction,
  disconnectWordPressAction,
} from "@/app/dashboard/settings/actions";
import { initialConnectionState } from "@/app/dashboard/settings/state";

const inputClass =
  "mt-1.5 w-full rounded-lg border border-line-strong bg-paper px-3 py-2.5 font-sans text-[15px] text-ink placeholder:text-muted/60 focus-visible:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft";

export default function WordPressConnectionForm({
  connection,
}: {
  connection: { siteUrl: string; username: string } | null;
}) {
  const [state, formAction, isPending] = useActionState(
    connectWordPressAction,
    initialConnectionState,
  );

  const connected =
    state.status === "connected"
      ? { siteUrl: state.siteUrl, username: state.username }
      : connection;

  if (connected) {
    return (
      <div className="rounded-2xl border border-line bg-surface p-6">
        <p className="font-mono text-xs uppercase tracking-[0.16em] text-good">
          Connected
        </p>
        <p className="mt-2 text-[15px] text-ink">
          <span className="font-semibold">{connected.username}</span> at{" "}
          <span className="font-semibold">{connected.siteUrl}</span>
        </p>
        <form action={disconnectWordPressAction} className="mt-5">
          <button
            type="submit"
            className="rounded-full border border-line-strong px-4 py-1.5 font-sans text-sm font-medium text-ink transition-colors hover:border-bad hover:text-bad"
          >
            Disconnect
          </button>
        </form>
      </div>
    );
  }

  return (
    <form
      action={formAction}
      className="space-y-4 rounded-2xl border border-line bg-surface p-6"
    >
      <label className="block">
        <span className="font-sans text-sm font-medium text-ink">Site URL</span>
        <input
          name="siteUrl"
          type="text"
          inputMode="url"
          placeholder="https://yoursite.com"
          required
          className={inputClass}
        />
      </label>
      <label className="block">
        <span className="font-sans text-sm font-medium text-ink">WordPress username</span>
        <input name="username" type="text" required className={inputClass} />
      </label>
      <label className="block">
        <span className="font-sans text-sm font-medium text-ink">
          Application Password
        </span>
        <input name="appPassword" type="password" required className={inputClass} />
        <span className="mt-1.5 block text-xs leading-relaxed text-muted">
          In your WordPress admin: Users → Profile → Application Passwords.
          This isn&apos;t your account password, and you can revoke it there
          any time without affecting your login.
        </span>
      </label>

      {state.status === "error" && (
        <p role="alert" className="text-sm text-bad">
          {state.error}
        </p>
      )}

      <button
        type="submit"
        disabled={isPending}
        className="inline-flex h-11 items-center justify-center rounded-full bg-accent px-6 font-sans text-[15px] font-semibold text-accent-ink transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-70"
      >
        {isPending ? "Connecting…" : "Connect"}
      </button>
    </form>
  );
}
