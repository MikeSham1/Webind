import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { wordpressConnections } from "@/lib/db/schema";
import { decryptSecret, encryptSecret } from "./crypto";
import type { WordPressCredentials } from "./wordpress";

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

/** Connect (or replace) a user's WordPress site. Caller is responsible for verifying the credentials first. Never throws. */
export async function saveWordPressConnection(
  userId: string,
  creds: WordPressCredentials,
): Promise<boolean> {
  return withDb("saveWordPressConnection", false, async (db) => {
    await db
      .insert(wordpressConnections)
      .values({
        userId,
        siteUrl: creds.siteUrl,
        username: creds.username,
        encryptedAppPassword: encryptSecret(creds.appPassword),
      })
      .onConflictDoUpdate({
        target: wordpressConnections.userId,
        set: {
          siteUrl: creds.siteUrl,
          username: creds.username,
          encryptedAppPassword: encryptSecret(creds.appPassword),
        },
      });
    return true;
  });
}

/** Connection status for display — no decryption, so it works even without CREDENTIALS_KEY. */
export async function getWordPressConnectionStatus(
  userId: string,
): Promise<{ siteUrl: string; username: string } | null> {
  return withDb("getWordPressConnectionStatus", null, async (db) => {
    const [row] = await db
      .select({ siteUrl: wordpressConnections.siteUrl, username: wordpressConnections.username })
      .from(wordpressConnections)
      .where(eq(wordpressConnections.userId, userId))
      .limit(1);
    return row ?? null;
  });
}

/** Usable credentials for publishing. Null if not connected, or the stored secret can't be decrypted. Never throws. */
export async function getWordPressCredentials(
  userId: string,
): Promise<WordPressCredentials | null> {
  return withDb("getWordPressCredentials", null, async (db) => {
    const [row] = await db
      .select()
      .from(wordpressConnections)
      .where(eq(wordpressConnections.userId, userId))
      .limit(1);
    if (!row) return null;
    const appPassword = decryptSecret(row.encryptedAppPassword);
    if (!appPassword) return null;
    return { siteUrl: row.siteUrl, username: row.username, appPassword };
  });
}

export async function deleteWordPressConnection(userId: string): Promise<boolean> {
  return withDb("deleteWordPressConnection", false, async (db) => {
    await db.delete(wordpressConnections).where(eq(wordpressConnections.userId, userId));
    return true;
  });
}
