"use server";

import { revalidatePath } from "next/cache";
import { normalizeUrl } from "@/lib/crawler/ssrf";
import { getCurrentUser, revokeOtherSessions, revokeSession } from "@/lib/auth";
import { deleteWordPressConnection, saveWordPressConnection } from "@/lib/integrations/connections";
import { testConnection as testWordPressConnection } from "@/lib/integrations/wordpress";
import {
  deleteGitHubConnection,
  saveGitHubConnection,
} from "@/lib/integrations/githubConnections";
import { testConnection as testGitHubConnection } from "@/lib/integrations/github";
import { checkRateLimit, formatRetryAfter } from "@/lib/rateLimit";
import type { GitHubConnectionState, WordPressConnectionState } from "./state";

/** Connect (or replace) the user's WordPress site. Verifies the credentials before saving. */
export async function connectWordPressAction(
  _prev: WordPressConnectionState,
  formData: FormData,
): Promise<WordPressConnectionState> {
  const user = await getCurrentUser();
  if (!user) return { status: "error", error: "Log in to connect a WordPress site." };

  // Each attempt makes an outbound request to a user-supplied host.
  const limit = checkRateLimit(`connect-wp:${user.id}`, 60 * 60 * 1000, 20);
  if (!limit.allowed) {
    return { status: "error", error: formatRetryAfter(limit.retryAfterMs) };
  }

  const siteUrl = normalizeUrl(String(formData.get("siteUrl") ?? ""));
  const username = String(formData.get("username") ?? "").trim();
  const appPassword = String(formData.get("appPassword") ?? "").trim();

  if (!siteUrl) {
    return {
      status: "error",
      error: "Enter your site's web address, e.g. https://yoursite.com.",
    };
  }
  // Every write here sends the Application Password as HTTP Basic auth —
  // trivially decodable, not encrypted — so plain http:// would put a real
  // credential on the wire in the clear. normalizeUrl() allows http because
  // it's shared with the report crawler, which has no credential to protect;
  // this connection does.
  if (!siteUrl.startsWith("https://")) {
    return {
      status: "error",
      error: "WordPress must be connected over https:// — this sends a real credential on every request.",
    };
  }
  if (!username || !appPassword) {
    return {
      status: "error",
      error: "Enter your WordPress username and Application Password.",
    };
  }

  const verified = await testWordPressConnection({ siteUrl, username, appPassword });
  if (!verified.ok) return { status: "error", error: verified.error };

  const saved = await saveWordPressConnection(user.id, { siteUrl, username, appPassword });
  if (!saved) {
    return {
      status: "error",
      error: "Couldn't save that connection — is a database configured?",
    };
  }

  revalidatePath("/dashboard/settings");
  return { status: "connected", siteUrl, username };
}

export async function disconnectWordPressAction(): Promise<void> {
  const user = await getCurrentUser();
  if (user) await deleteWordPressConnection(user.id);
  revalidatePath("/dashboard/settings");
}

/** Connect (or replace) the user's GitHub repo. Verifies the token before saving. */
export async function connectGitHubAction(
  _prev: GitHubConnectionState,
  formData: FormData,
): Promise<GitHubConnectionState> {
  const user = await getCurrentUser();
  if (!user) return { status: "error", error: "Log in to connect a GitHub repo." };

  const limit = checkRateLimit(`connect-gh:${user.id}`, 60 * 60 * 1000, 20);
  if (!limit.allowed) {
    return { status: "error", error: formatRetryAfter(limit.retryAfterMs) };
  }

  const owner = String(formData.get("owner") ?? "").trim();
  const repo = String(formData.get("repo") ?? "").trim();
  const token = String(formData.get("token") ?? "").trim();

  if (!owner || !repo) {
    return { status: "error", error: "Enter the repo owner and name, e.g. acme / site." };
  }
  if (!token) {
    return { status: "error", error: "Enter a Personal Access Token." };
  }

  const verified = await testGitHubConnection({ owner, repo, token });
  if (!verified.ok) return { status: "error", error: verified.error };

  const saved = await saveGitHubConnection(user.id, { owner, repo, token });
  if (!saved) {
    return {
      status: "error",
      error: "Couldn't save that connection — is a database configured?",
    };
  }

  revalidatePath("/dashboard/settings");
  return { status: "connected", owner, repo };
}

export async function disconnectGitHubAction(): Promise<void> {
  const user = await getCurrentUser();
  if (user) await deleteGitHubConnection(user.id);
  revalidatePath("/dashboard/settings");
}

/** Sign a single device/session out. Scoped to the caller's own sessions. */
export async function revokeSessionAction(formData: FormData): Promise<void> {
  const user = await getCurrentUser();
  if (!user) return;
  const sessionId = String(formData.get("sessionId") ?? "");
  if (sessionId) await revokeSession(user.id, sessionId);
  revalidatePath("/dashboard/settings");
}

/** "Log out all other devices" — keeps the session making this request. */
export async function revokeOtherSessionsAction(): Promise<void> {
  const user = await getCurrentUser();
  if (!user) return;
  await revokeOtherSessions(user.id, user.sessionId);
  revalidatePath("/dashboard/settings");
}
