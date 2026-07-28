import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

type Db = ReturnType<typeof drizzle<typeof schema>>;

let cached: Db | null = null;
let testDb: Db | null = null;

/**
 * Test-only: inject a Drizzle instance (e.g. one backed by in-process PGlite)
 * so the data layer can be exercised against real Postgres without a server.
 * Pass null to clear. No effect in production paths.
 */
export function __setTestDb(db: unknown): void {
  testDb = (db as Db | null) ?? null;
}

/**
 * Returns a Drizzle client, or `null` when DATABASE_URL is unset. Callers treat
 * a null client as "persistence disabled" so the app runs fine without a
 * database (local dev, or a deploy before Postgres is provisioned).
 */
export function getDb(): Db | null {
  if (testDb) return testDb;
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  if (!cached) {
    const client = postgres(url, { max: 5, prepare: false });
    cached = drizzle(client, { schema });
  }
  return cached;
}

export { schema };
