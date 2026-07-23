"use client";

import { useActionState } from "react";
import { submitLead, initialLeadState } from "@/app/actions";

/**
 * Email capture shown under the results CTA. Attaches the visitor's email to
 * the logged report run. Only rendered when the run was persisted (requestId
 * present), i.e. when a database is configured.
 */
export default function LeadCapture({ requestId }: { requestId: string }) {
  const [state, formAction, isPending] = useActionState(
    submitLead,
    initialLeadState,
  );

  if (state.status === "done") {
    return (
      <p
        role="status"
        className="mt-6 font-sans text-[15px] font-medium text-good"
      >
        You&apos;re on the list — we&apos;ll be in touch with your optimization
        plan.
      </p>
    );
  }

  return (
    <form action={formAction} className="mx-auto mt-6 w-full max-w-md">
      <input type="hidden" name="requestId" value={requestId} />
      <label htmlFor="lead-email" className="sr-only">
        Email address
      </label>
      <div className="flex flex-col gap-3 sm:flex-row">
        <input
          id="lead-email"
          name="email"
          type="email"
          required
          placeholder="you@company.com"
          disabled={isPending}
          aria-invalid={state.status === "error"}
          aria-describedby={state.status === "error" ? "lead-error" : undefined}
          className="h-12 flex-1 rounded-full border border-line-strong bg-paper px-5 font-sans text-[15px] text-ink placeholder:text-muted/70 focus-visible:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={isPending}
          className="inline-flex h-12 shrink-0 items-center justify-center rounded-full bg-accent px-7 font-sans text-[15px] font-semibold text-accent-ink transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-70"
        >
          {isPending ? "Sending…" : "Get early access"}
        </button>
      </div>

      {state.status === "error" && (
        <p id="lead-error" role="alert" className="mt-3 text-sm text-bad">
          {state.error}
        </p>
      )}
    </form>
  );
}
