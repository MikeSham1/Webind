// Plain module (NOT a server-action file) so it can export non-function values.
// A server-action file may only export async functions.

export type ConnectionState =
  | { status: "idle" }
  | { status: "connected"; siteUrl: string; username: string }
  | { status: "error"; error: string };

export const initialConnectionState: ConnectionState = { status: "idle" };
