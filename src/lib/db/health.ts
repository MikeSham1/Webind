import { sql } from "drizzle-orm";
import { getDb } from "./index";

export type DatabaseHealth = "ok" | "unreachable" | "not_configured";

/** How long a real database gets to answer before it counts as unreachable. */
const CHECK_TIMEOUT_MS = 3000;

/**
 * A trivial, fast query that proves the database is actually reachable.
 *
 * `timeoutMs` exists for tests: they run an in-process database (PGlite) whose
 * first query can legitimately take longer than 3s on a loaded machine, which
 * made the "ok" test fail intermittently. Production callers use the default.
 */
export async function checkDatabaseHealth(
  opts: { timeoutMs?: number } = {},
): Promise<DatabaseHealth> {
  const db = getDb();
  if (!db) return "not_configured";

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      db.execute(sql`select 1`),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("database health check timed out")),
          opts.timeoutMs ?? CHECK_TIMEOUT_MS,
        );
      }),
    ]);
    return "ok";
  } catch {
    return "unreachable";
  } finally {
    // Don't leave the timer running after the query has already answered.
    clearTimeout(timer);
  }
}
