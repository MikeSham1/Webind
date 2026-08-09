// Plain module (NOT "use server") so it can export non-function values.
// A "use server" file may only export async functions.

export type AuthState = { status: "idle" } | { status: "error"; error: string };

export const initialAuthState: AuthState = { status: "idle" };

/**
 * Deliberately has only one non-idle outcome ("requested") regardless of
 * whether the email exists — the UI must show the same message either way so
 * a stranger can't use a different response to enumerate registered emails.
 */
export type ForgotPasswordState = { status: "idle" } | { status: "requested" };

export const initialForgotPasswordState: ForgotPasswordState = { status: "idle" };

export type ResetPasswordState =
  | { status: "idle" }
  | { status: "done" }
  | { status: "error"; error: string };

export const initialResetPasswordState: ResetPasswordState = { status: "idle" };

export type VerifyEmailState =
  | { status: "idle" }
  | { status: "done" }
  | { status: "error"; error: string };

export const initialVerifyEmailState: VerifyEmailState = { status: "idle" };

export type DeleteAccountState = { status: "idle" } | { status: "error"; error: string };

export const initialDeleteAccountState: DeleteAccountState = { status: "idle" };
