/**
 * A local Postgres for development, with nothing to install: the same
 * embedded-postgres binary the e2e suite uses (e2e/global-setup.ts), but
 * persistent, so accounts and subscriptions survive restarts.
 *
 *   npm run db:local      # start it; leave this terminal open (Ctrl+C stops it)
 *   npm run db:migrate    # in another terminal, once, to create the tables
 *
 * Data lives in .local-pgdata/ (gitignored). Delete that folder to start over.
 * Port 54320, so it never collides with e2e (54329) or a system Postgres (5432).
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import EmbeddedPostgres from "embedded-postgres";

const PORT = 54320;
const DATA_DIR = join(import.meta.dirname, "..", "..", ".local-pgdata");
const DATABASE_URL = `postgres://postgres:postgres@127.0.0.1:${PORT}/postgres`;

const pg = new EmbeddedPostgres({
  databaseDir: DATA_DIR,
  user: "postgres",
  password: "postgres",
  port: PORT,
  persistent: true,
});

if (!existsSync(DATA_DIR)) {
  console.log("First run: creating the local database…");
  await pg.initialise();
}
await pg.start();

console.log(`
Local Postgres is running.

  DATABASE_URL=${DATABASE_URL}

Put that line in .env.local, then (first time only) run in another terminal:
  npm run db:migrate

Leave this terminal open. Ctrl+C stops the database.
`);

let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  console.log("\nStopping Postgres…");
  await pg.stop();
  process.exit(0);
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
