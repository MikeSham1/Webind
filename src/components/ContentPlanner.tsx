"use client";

import { useEffect, useRef, useState } from "react";
import { planContentAction } from "@/app/studio/planner-actions";
import { initialPlannerState } from "@/app/studio/planner-state";
import { useActionState } from "react";

/**
 * The conversational half of Content Studio, and the first thing a signed-in
 * user sees. Designed as a real chat surface rather than a form with a log:
 * an inviting empty state with concrete openers (a blank box is the main reason
 * people bounce off a planner), message bubbles that make it obvious who is
 * speaking, a typing indicator so a slow model doesn't read as a hang, and a
 * composer that sends on Enter.
 */

const STARTERS = [
  "Write a landing page for my main service",
  "A blog post answering a question customers keep asking",
  "Improve a page that isn't getting picked up by AI",
  "Turn my report's top fixes into a new page",
];

export default function ContentPlanner() {
  const [state, action, isPending] = useActionState(planContentAction, initialPlannerState);
  const [message, setMessage] = useState("");
  const formRef = useRef<HTMLFormElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const sentCount = useRef(0);

  const hasChat = state.messages.length > 0;

  // Clear the composer once a turn has actually been recorded, rather than
  // optimistically on submit (which would lose the text if the action failed).
  useEffect(() => {
    if (state.messages.length > sentCount.current) {
      sentCount.current = state.messages.length;
      setMessage("");
    }
  }, [state.messages.length]);

  // Keep the newest turn in view as the conversation grows.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [state.messages.length, isPending]);

  return (
    <section className="overflow-hidden rounded-2xl border border-line bg-surface">
      <header className="border-b border-line px-6 py-5 sm:px-8">
        <h2 className="font-display text-xl font-semibold text-ink">
          Plan it out loud
        </h2>
        <p className="mt-1 text-sm leading-relaxed text-muted">
          Think through the page with AI first. It asks only what actually
          sharpens the brief — then you turn that into a grounded draft below.
        </p>
      </header>

      {/* Conversation */}
      <div
        ref={scrollRef}
        className="max-h-[26rem] min-h-[13rem] overflow-y-auto px-6 py-6 sm:px-8"
      >
        {hasChat ? (
          <div className="flex flex-col gap-5">
            {state.messages.map((m, i) =>
              m.role === "assistant" ? (
                <AssistantTurn key={i} text={m.text} />
              ) : (
                <UserTurn key={i} text={m.text} />
              ),
            )}
            {isPending && <TypingTurn />}
          </div>
        ) : (
          <EmptyState onPick={(text) => setMessage(text)} pending={isPending} />
        )}
      </div>

      {/* Composer */}
      <form
        ref={formRef}
        action={action}
        className="border-t border-line bg-paper/60 px-6 py-4 sm:px-8"
      >
        <div className="relative">
          <label htmlFor="planner-message" className="sr-only">
            Message
          </label>
          <textarea
            id="planner-message"
            name="message"
            required
            rows={3}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={(e) => {
              // Enter sends, Shift+Enter makes a new line — chat convention.
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if (message.trim() && !isPending) formRef.current?.requestSubmit();
              }
            }}
            placeholder="Tell it what you're trying to write, and what you already know…"
            className="w-full resize-none rounded-xl border border-line-strong bg-surface py-3 pl-4 pr-28 font-sans text-[15px] leading-relaxed text-ink placeholder:text-muted/60 focus-visible:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft"
          />
          <button
            type="submit"
            disabled={isPending || !message.trim()}
            className="absolute bottom-3 right-3 inline-flex h-9 items-center justify-center gap-1.5 rounded-full bg-accent px-4 font-sans text-sm font-semibold text-accent-ink transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
          >
            {isPending ? "Thinking…" : hasChat ? "Send" : "Start"}
          </button>
        </div>

        <div className="mt-2 flex items-center justify-between gap-3">
          <p className="text-xs text-muted">
            <kbd className="rounded border border-line px-1 py-0.5 font-sans text-[10px]">
              Enter
            </kbd>{" "}
            to send ·{" "}
            <kbd className="rounded border border-line px-1 py-0.5 font-sans text-[10px]">
              Shift
            </kbd>
            +
            <kbd className="rounded border border-line px-1 py-0.5 font-sans text-[10px]">
              Enter
            </kbd>{" "}
            for a new line
          </p>
          <p className="text-xs text-muted">Planning only — nothing is published</p>
        </div>

        {state.status === "error" && (
          <p role="alert" className="mt-3 text-sm text-bad">
            {state.error}
          </p>
        )}
      </form>
    </section>
  );
}

function EmptyState({
  onPick,
  pending,
}: {
  onPick: (text: string) => void;
  pending: boolean;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center py-4 text-center">
      <span
        aria-hidden="true"
        className="flex h-11 w-11 items-center justify-center rounded-full bg-accent-soft text-accent"
      >
        <SparkleIcon size={20} />
      </span>
      <p className="mt-3 font-display text-lg font-semibold text-ink">
        What are we writing?
      </p>
      <p className="mx-auto mt-1.5 max-w-sm text-sm leading-relaxed text-muted">
        Describe it in your own words — or start from one of these.
      </p>
      <div className="mt-5 flex flex-wrap justify-center gap-2">
        {STARTERS.map((s) => (
          <button
            key={s}
            type="button"
            disabled={pending}
            onClick={() => onPick(s)}
            className="rounded-full border border-line bg-paper px-3.5 py-2 text-left font-sans text-[13px] text-ink transition-colors hover:border-accent hover:text-accent disabled:opacity-50"
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}

function AssistantTurn({ text }: { text: string }) {
  return (
    <div className="flex items-start gap-3">
      <span
        aria-hidden="true"
        className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent"
      >
        <SparkleIcon size={14} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="mb-1 font-sans text-xs font-semibold text-accent">
          WeBind AI<span className="sr-only"> says:</span>
        </p>
        <div className="whitespace-pre-wrap rounded-2xl rounded-tl-sm border border-line bg-paper px-4 py-3 text-sm leading-relaxed text-ink">
          {text}
        </div>
      </div>
    </div>
  );
}

function UserTurn({ text }: { text: string }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-accent px-4 py-3 text-sm leading-relaxed text-accent-ink">
        {text}
      </div>
    </div>
  );
}

/** Three pulsing dots while the model is composing a reply. */
function TypingTurn() {
  return (
    <div className="flex items-start gap-3" aria-live="polite" aria-label="Thinking">
      <span
        aria-hidden="true"
        className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent"
      >
        <SparkleIcon size={14} />
      </span>
      <div className="flex items-center gap-1.5 rounded-2xl rounded-tl-sm border border-line bg-paper px-4 py-3.5">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            aria-hidden="true"
            className="h-1.5 w-1.5 rounded-full bg-muted"
            style={{ animation: "pulse-soft 1.2s ease-in-out infinite", animationDelay: `${i * 160}ms` }}
          />
        ))}
      </div>
    </div>
  );
}

function SparkleIcon({ size = 16 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden="true">
      <path d="M12 2l1.9 5.6a4 4 0 0 0 2.5 2.5L22 12l-5.6 1.9a4 4 0 0 0-2.5 2.5L12 22l-1.9-5.6a4 4 0 0 0-2.5-2.5L2 12l5.6-1.9a4 4 0 0 0 2.5-2.5L12 2z" />
    </svg>
  );
}
