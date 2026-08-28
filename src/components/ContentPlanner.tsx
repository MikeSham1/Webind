"use client";

import { useActionState } from "react";
import { planContentAction } from "@/app/studio/planner-actions";
import { initialPlannerState } from "@/app/studio/planner-state";

export default function ContentPlanner() {
  const [state, action, isPending] = useActionState(planContentAction, initialPlannerState);

  return (
    <section className="mb-8 rounded-2xl border border-line bg-surface p-6 sm:p-8">
      <div className="mb-5">
        <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted">
          Plan with Gemini 3.7
        </p>
        <h2 className="mt-1 font-display text-2xl font-semibold text-ink">
          Talk through what you want to write
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          Describe the page, goal, audience, or facts you already have. Gemini will ask only the clarifying questions that materially improve the brief. When the direction is clear, use the answers in the grounded draft form below.
        </p>
      </div>

      {state.transcript && (
        <div className="mb-5 max-h-72 overflow-y-auto whitespace-pre-wrap rounded-xl border border-line bg-paper p-4 text-sm leading-relaxed text-ink">
          {state.transcript}
        </div>
      )}

      <form action={action} className="space-y-3">
        <textarea
          name="message"
          required
          rows={3}
          placeholder="I want a landing page for our managed IT service, but I'm not sure what angle or proof points matter most…"
          className="w-full rounded-lg border border-line-strong bg-paper px-3 py-2.5 font-sans text-[15px] text-ink placeholder:text-muted/60 focus-visible:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft"
        />
        <div className="flex items-center gap-4">
          <button
            type="submit"
            disabled={isPending}
            className="inline-flex h-10 items-center justify-center rounded-full border border-line-strong bg-paper px-5 font-sans text-sm font-semibold text-ink transition-colors hover:border-accent disabled:cursor-not-allowed disabled:opacity-70"
          >
            {isPending ? "Thinking…" : state.transcript ? "Continue planning" : "Start planning"}
          </button>
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted">
            Medium thinking · planning only
          </span>
        </div>
        {state.status === "error" && (
          <p role="alert" className="text-sm text-bad">
            {state.error}
          </p>
        )}
      </form>
    </section>
  );
}
