import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { readFileSync, readdirSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import EmbeddedPostgres from "embedded-postgres";
import postgres from "postgres";

/**
 * End-to-end golden-path tests need a real signed-in app, which means a real
 * Postgres and a real running server — neither exists in the unit/integration
 * test setup (PGlite in-process). This spins both up from scratch before the
 * suite runs and tears them down after: a disposable embedded Postgres (real
 * Postgres, not a mock — the same approach used to manually verify this
 * session's persistence work) with every committed migration applied, and a
 * `next dev` instance pointed at it with SITE_PUBLIC and a seed admin account
 * set so the suite can log in without going through signup every time.
 *
 * Runs on a dedicated port (3100) and a dedicated Postgres port (54329) so it
 * never collides with a developer's own `npm run dev` on 3000.
 */

const PG_PORT = 54329;
export const APP_PORT = 3100;
export const E2E_BASE_URL = `http://localhost:${APP_PORT}`;
export const SEED_ADMIN_EMAIL = "e2e-admin@webind.test";
export const SEED_ADMIN_PASSWORD = "E2eAdminPass123!";

const DATA_DIR = join(__dirname, ".e2e-pgdata");
const DATABASE_URL = `postgres://postgres:postgres@127.0.0.1:${PG_PORT}/postgres`;

async function waitForReady(timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${E2E_BASE_URL}/api/ready`);
      if (res.status === 200) return;
    } catch (err) {
      lastError = err;
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`Dev server never became ready: ${String(lastError)}`);
}

export default async function globalSetup(): Promise<() => Promise<void>> {
  if (existsSync(DATA_DIR)) rmSync(DATA_DIR, { recursive: true, force: true });

  const pg = new EmbeddedPostgres({
    databaseDir: DATA_DIR,
    user: "postgres",
    password: "postgres",
    port: PG_PORT,
    persistent: true,
  });
  await pg.initialise();
  await pg.start();

  const migrationsDir = join(__dirname, "..", "drizzle");
  const sql = postgres(DATABASE_URL, { max: 1, prepare: false });
  const files = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();
  for (const f of files) {
    await sql.unsafe(readFileSync(join(migrationsDir, f), "utf8"));
  }
  await sql.end();

  let output = "";
  // Invoke Next's CLI script directly via node, rather than the `next`/`npx`
  // shims — those are .cmd files on Windows, which `child_process.spawn` can't
  // exec without `shell: true`, and shell mode doesn't safely quote argv.
  const nextBin = join(__dirname, "..", "node_modules", "next", "dist", "bin", "next");
  const server: ChildProcessWithoutNullStreams = spawn(
    process.execPath,
    [nextBin, "dev", "-p", String(APP_PORT)],
    {
      cwd: join(__dirname, ".."),
      env: {
        ...process.env,
        DATABASE_URL,
        // Build into .next-e2e, so this server can run alongside a developer's
        // own `npm run dev` instead of colliding on .next/dev/lock.
        NEXT_DIST_DIR: ".next-e2e",
        SITE_PUBLIC: "true",
        SEED_ADMIN_EMAIL,
        SEED_ADMIN_PASSWORD,
      },
    },
  );
  server.stdout.on("data", (d: Buffer) => { output += d.toString(); });
  server.stderr.on("data", (d: Buffer) => { output += d.toString(); });

  try {
    await waitForReady(60_000);
  } catch (err) {
    console.error("--- next dev output ---\n" + output);
    server.kill();
    await pg.stop();
    throw err;
  }

  return async () => {
    server.kill();
    await pg.stop();
    if (existsSync(DATA_DIR)) rmSync(DATA_DIR, { recursive: true, force: true });
  };
}
