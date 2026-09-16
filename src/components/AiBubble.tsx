import type { ReactNode } from "react";

/**
 * A chat-style speech bubble for text the AI generated, so it reads clearly as
 * "the AI is talking to you" rather than as plain page copy. Used for the
 * Gemini-written report narrative and anywhere else AI prose is shown.
 */
export default function AiBubble({
  children,
  label = "WeBind AI",
}: {
  children: ReactNode;
  label?: string;
}) {
  return (
    <div className="mx-auto mt-6 flex max-w-xl items-start gap-3 text-left">
      {/* Avatar */}
      <span
        aria-hidden="true"
        className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent"
      >
        <SparkleIcon />
      </span>

      <div className="min-w-0 flex-1">
        <p className="mb-1.5 font-sans text-xs font-semibold text-accent">
          {label}
          <span className="sr-only"> says:</span>
        </p>

        {/* Bubble with a small tail pointing back at the avatar */}
        <div className="relative rounded-2xl rounded-tl-sm border border-line bg-surface px-4 py-3">
          <span
            aria-hidden="true"
            className="absolute -left-1.5 top-3 h-3 w-3 rotate-45 border-b border-l border-line bg-surface"
          />
          <p className="relative text-[15px] leading-relaxed text-ink">
            {children}
          </p>
        </div>
      </div>
    </div>
  );
}

function SparkleIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M12 2l1.9 5.6a4 4 0 0 0 2.5 2.5L22 12l-5.6 1.9a4 4 0 0 0-2.5 2.5L12 22l-1.9-5.6a4 4 0 0 0-2.5-2.5L2 12l5.6-1.9a4 4 0 0 0 2.5-2.5L12 2z" />
    </svg>
  );
}
