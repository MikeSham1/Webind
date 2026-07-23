// Plain module (NOT "use server") so it can export non-function values.
// A "use server" file may only export async functions.

export type AuthState = { status: "idle" } | { status: "error"; error: string };

export const initialAuthState: AuthState = { status: "idle" };
