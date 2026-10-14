"use client";

import { useId, useState, type InputHTMLAttributes } from "react";

const fieldClass =
  "w-full rounded-lg border border-line-strong bg-paper py-2.5 pl-3 pr-12 font-sans text-[15px] text-ink placeholder:text-muted/60 focus-visible:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft";

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "className"> & {
  /** Spacing around the field (the input itself is styled here). */
  wrapperClassName?: string;
};

/** Eye (password hidden: click to show) and eye-with-slash (password shown). */
function EyeIcon({ crossed }: { crossed: boolean }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" />
      <circle cx="12" cy="12" r="3" />
      {crossed && <path d="M4 4l16 16" />}
    </svg>
  );
}

/**
 * A password field with a show/hide toggle, so people can check what they
 * typed instead of guessing at dots. Used for every password and secret
 * field (account passwords, the site gate, WordPress/GitHub credentials).
 *
 * The toggle is a quiet eye icon inside the field: muted until hovered, so it
 * never competes with the form's main button. It's a real button (keyboard
 * reachable, type="button" so it never submits). Its accessible name stays
 * "Show password" while aria-pressed carries the state; a name that flips to
 * "Hide password" as well would be announced as "Hide password, pressed".
 * Browsers still offer to save or fill the password either way.
 */
export default function PasswordInput({ wrapperClassName = "mt-1.5", id, ...inputProps }: Props) {
  const [visible, setVisible] = useState(false);
  const generatedId = useId();
  const inputId = id ?? generatedId;

  return (
    <div className={`relative ${wrapperClassName}`}>
      <input
        {...inputProps}
        id={inputId}
        type={visible ? "text" : "password"}
        // Never autocorrect or capitalize a password shown as plain text.
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        className={fieldClass}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-controls={inputId}
        aria-pressed={visible}
        aria-label="Show password"
        title={visible ? "Hide password" : "Show password"}
        className="absolute right-1.5 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-muted transition-colors hover:bg-line/40 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft"
      >
        <EyeIcon crossed={visible} />
      </button>
    </div>
  );
}
