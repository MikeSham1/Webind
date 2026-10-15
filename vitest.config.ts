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
  },
  resolve: {
    // Match the "@/*" -> "./src/*" alias used by Next/TypeScript.
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
