"use client";

import { useActionState } from "react";
import {
  connectGitHubAction,
  disconnectGitHubAction,
} from "@/app/dashboard/settings/actions";
import { initialGitHubConnectionState } from "@/app/dashboard/settings/state";
import PasswordInput from "@/components/PasswordInput";

const inputClass =
  "mt-1.5 w-full rounded-lg border border-line-strong bg-paper px-3 py-2.5 font-sans text-[15px] text-ink placeholder:text-muted/60 focus-visible:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft";

export default function GitHubConnectionForm({
  connection,
}: {
  connection: { owner: string; repo: string } | null;
}) {
  const [state, formAction, isPending] = useActionState(
    connectGitHubAction,
    initialGitHubConnectionState,
  );

  const connected =
    state.status === "connected" ? { owner: state.owner, repo: state.repo } : connection;

  if (connected) {
    return (
      <div className="rounded-2xl border border-line bg-surface p-6">
        <p className="font-mono text-xs uppercase tracking-[0.16em] text-good">
          Connected
        </p>
        <p className="mt-2 text-[15px] text-ink">
          <span className="font-semibold">
            {connected.owner}/{connected.repo}
          </span>
        </p>
        <form action={disconnectGitHubAction} className="mt-5">
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
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="font-sans text-sm font-medium text-ink">Repo owner</span>
          <input name="owner" type="text" placeholder="acme" required className={inputClass} />
        </label>
        <label className="block">
          <span className="font-sans text-sm font-medium text-ink">Repo name</span>
          <input name="repo" type="text" placeholder="site" required className={inputClass} />
        </label>
      </div>
      <label className="block">
        <span className="font-sans text-sm font-medium text-ink">
          Personal Access Token
        </span>
        <PasswordInput name="token" autoComplete="off" required />
        <span className="mt-1.5 block text-xs leading-relaxed text-muted">
          A fine-grained token (Settings → Developer settings → Personal
          access tokens) scoped to just this repo, with Contents and Pull
          requests set to Read and write.
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
