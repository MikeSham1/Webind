"use client";

import { useActionState } from "react";
import { addSiteAction, selectSiteAction } from "@/app/sites/actions";
import { initialSiteActionState } from "@/app/sites/state";
import type { SiteRow } from "@/lib/db/schema";

/** No known site yet: offer to name one rather than silently having no context. */
export function AddSiteForm() {
  const [state, formAction, isPending] = useActionState(addSiteAction, initialSiteActionState);

  return (
    <div className="rounded-2xl border border-line bg-surface p-4">
      <p className="text-sm text-ink">
        Which website are we working on?{" "}
        <span className="text-muted">
          Run a report and we&apos;ll remember it, or add it here.
        </span>
      </p>
      <form action={formAction} className="mt-3 flex flex-col gap-2 sm:flex-row">
        <label htmlFor="site-url" className="sr-only">
          Website domain
        </label>
        <input
          id="site-url"
          name="url"
          type="text"
          inputMode="url"
          placeholder="yourdomain.com"
          aria-invalid={state.status === "error"}
          aria-describedby={state.status === "error" ? "site-url-error" : undefined}
          className="flex-1 rounded-lg border border-line-strong bg-paper px-3 py-2 font-sans text-sm text-ink placeholder:text-muted/60 focus-visible:border-accent focus-visible:outline-none"
        />
        <button
          type="submit"
          disabled={isPending}
          className="inline-flex h-9 shrink-0 items-center justify-center rounded-full bg-accent px-4 font-sans text-sm font-semibold text-accent-ink transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-70"
        >
          {isPending ? "Adding…" : "Use this site"}
        </button>
      </form>
      {state.status === "error" && (
        <p id="site-url-error" role="alert" className="mt-2 text-sm text-bad">
          {state.error}
        </p>
      )}
    </div>
  );
}

export function SwitchSiteForm({ active, all }: { active: SiteRow; all: SiteRow[] }) {
  const [state, formAction, isPending] = useActionState(selectSiteAction, initialSiteActionState);

  return (
    <div className="flex flex-col items-end gap-1">
      <form action={formAction} className="flex items-center gap-2">
        <label htmlFor="siteId" className="sr-only">
          Switch website
        </label>
        <select
          id="siteId"
          name="siteId"
          defaultValue={active.id}
          disabled={isPending}
          className="rounded-full border border-line bg-paper px-3 py-1.5 font-sans text-sm text-ink focus-visible:border-accent focus-visible:outline-none disabled:opacity-70"
        >
          {all.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label ?? s.host}
            </option>
          ))}
        </select>
        <button
          type="submit"
          disabled={isPending}
          className="rounded-full px-3 py-1.5 font-sans text-sm font-medium text-accent transition-colors hover:underline disabled:cursor-not-allowed disabled:opacity-70"
        >
          {isPending ? "Switching…" : "Switch"}
        </button>
      </form>
      {state.status === "error" && (
        <p role="alert" className="text-xs text-bad">
          {state.error}
        </p>
      )}
    </div>
  );
}
