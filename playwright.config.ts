import { defineConfig } from "@playwright/test";
import { E2E_BASE_URL } from "./e2e/global-setup";

/**
 * Golden-path E2E tests against a real Postgres and a real running server
 * (see e2e/global-setup.ts) — the layer unit/integration tests can't cover:
 * does the actual browser-rendered flow work end to end.
 *
 * Not part of `npm test` — run explicitly with `npm run test:e2e`. Serial and
 * single-worker: every test shares one server and one database, so isolation
 * comes from each test using its own unique account, not from parallelism.
 */
export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: E2E_BASE_URL,
    trace: "retain-on-failure",
  },
});
