import { sql } from "drizzle-orm";
import { getDb } from "./index";

export type DatabaseHealth = "ok" | "unreachable" | "not_configured";

const CHECK_TIMEOUT_MS = 3000;

/** A trivial, fast query that proves the database is actually reachable. */
export async function checkDatabaseHealth(): Promise<DatabaseHealth> {
  const db = getDb();
  if (!db) return "not_configured";

  try {
    await Promise.race([
      db.execute(sql`select 1`),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("database health check timed out")), CHECK_TIMEOUT_MS),
      ),
    ]);
    return "ok";
  } catch {
    return "unreachable";
  }
}
