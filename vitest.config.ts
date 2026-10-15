import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "scripts/**/*.test.ts"],
    environment: "node",
    passWithNoTests: true,
    // The defaults (5s per test, 10s per hook) assume pure in-memory tests.
    // Some here launch a real Chromium (crawl.test.ts beforeAll) or a real
    // embedded Postgres, and import heavy modules on first use. On a busy
    // machine (a dev server compiling alongside the suite, a shared CI
    // runner) those legitimately run past the defaults and failed as
    // timeouts, not bugs. A genuine hang still fails, just later.
    testTimeout: 20_000,
    hookTimeout: 60_000,
    // Many files boot their own in-process Postgres (PGlite) or a Chromium.
    // One worker per core starts them all at once, and on an already-busy
    // machine that pile-up stalled every database suite in the same run.
    // Half the cores measured just as fast (~7-8s) without the spike.
    maxWorkers: "50%",
  },
  resolve: {
    // Match the "@/*" -> "./src/*" alias used by Next/TypeScript.
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
