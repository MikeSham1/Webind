// Plain module (NOT a server-action file) so it can export non-function values.
// A server-action file may only export async functions.

export type WordPressConnectionState =
  | { status: "idle" }
  | {
      status: "connected";
      siteUrl: string;
      username: string;
      /** Set when this account can't publish every content type this app can create — see testConnection's capability check. */
      capabilityWarning?: string;
    }
  | { status: "error"; error: string };

export const initialWordPressConnectionState: WordPressConnectionState = { status: "idle" };

export type GitHubConnectionState =
  | { status: "idle" }
  | { status: "connected"; owner: string; repo: string }
  | { status: "error"; error: string };

export const initialGitHubConnectionState: GitHubConnectionState = { status: "idle" };
