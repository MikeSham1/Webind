import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
    passWithNoTests: true,
  },
  resolve: {
    // Match the "@/*" -> "./src/*" alias used by Next/TypeScript.
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
