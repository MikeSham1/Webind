import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";

/**
 * Packages that must stay on exactly the same version as a partner. Each pair
 * broke CI once when it drifted, so this fails fast with the fix spelled out
 * instead of surfacing later as a confusing browser or lint error.
 */
const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as {
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
};
const all = { ...pkg.dependencies, ...pkg.devDependencies };
const EXACT = /^\d+\.\d+\.\d+$/;

describe("dependency pins", () => {
  it("pins @playwright/test to the crawler's exact Playwright version", () => {
    // CI downloads Chromium with @playwright/test's CLI, but the crawler (and
    // the production image, playwright:vX) launches `playwright`'s browser
    // build. Different versions mean a browser that was never downloaded:
    // "browserType.launch: Executable doesn't exist".
    expect(all.playwright, "playwright must be an exact version").toMatch(EXACT);
    expect(
      all["@playwright/test"],
      `set "@playwright/test" to "${all.playwright}" (exact, no ^) to match "playwright"`,
    ).toBe(all.playwright);
  });

  it("keeps eslint-config-next on the same exact version as next", () => {
    expect(all.next, "next must be an exact version").toMatch(EXACT);
    expect(
      all["eslint-config-next"],
      `set "eslint-config-next" to "${all.next}" to match "next"`,
    ).toBe(all.next);
  });
});
