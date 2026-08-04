import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { githubConnections } from "@/lib/db/schema";
import { decryptSecret, encryptSecret } from "./crypto";
import type { GitHubCredentials } from "./github";

type Database = NonNullable<ReturnType<typeof getDb>>;

/** Runs `fn` against the DB, or returns `fallback` when persistence is off or the query fails. Never throws. */
async function withDb<T>(
  label: string,
  fallback: T,
  fn: (db: Database) => Promise<T>,
): Promise<T> {
  const db = getDb();
  if (!db) return fallback;
  try {
    return await fn(db);
  } catch (err) {
    console.error(`${label} failed:`, err);
    return fallback;
  }
}

/** Connect (or replace) a user's GitHub repo. Caller is responsible for verifying the token first. Never throws. */
export async function saveGitHubConnection(
  userId: string,
  creds: GitHubCredentials,
): Promise<boolean> {
  return withDb("saveGitHubConnection", false, async (db) => {
    await db
      .insert(githubConnections)
      .values({
        userId,
        repoOwner: creds.owner,
        repoName: creds.repo,
        encryptedToken: encryptSecret(creds.token),
      })
      .onConflictDoUpdate({
        target: githubConnections.userId,
        set: {
          repoOwner: creds.owner,
          repoName: creds.repo,
          encryptedToken: encryptSecret(creds.token),
        },
      });
    return true;
  });
}

/** Connection status for display — no decryption, so it works even without CREDENTIALS_KEY. */
export async function getGitHubConnectionStatus(
  userId: string,
): Promise<{ owner: string; repo: string } | null> {
  return withDb("getGitHubConnectionStatus", null, async (db) => {
    const [row] = await db
      .select({ owner: githubConnections.repoOwner, repo: githubConnections.repoName })
      .from(githubConnections)
      .where(eq(githubConnections.userId, userId))
      .limit(1);
    return row ?? null;
  });
}

/** Usable credentials for opening a PR. Null if not connected, or the stored secret can't be decrypted. Never throws. */
export async function getGitHubCredentials(
  userId: string,
): Promise<GitHubCredentials | null> {
  return withDb("getGitHubCredentials", null, async (db) => {
    const [row] = await db
      .select()
      .from(githubConnections)
      .where(eq(githubConnections.userId, userId))
      .limit(1);
    if (!row) return null;
    const token = decryptSecret(row.encryptedToken);
    if (!token) return null;
    return { owner: row.repoOwner, repo: row.repoName, token };
  });
}

export async function deleteGitHubConnection(userId: string): Promise<boolean> {
  return withDb("deleteGitHubConnection", false, async (db) => {
    await db.delete(githubConnections).where(eq(githubConnections.userId, userId));
    return true;
  });
}
