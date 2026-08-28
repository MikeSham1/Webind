import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { explainReport } from "./explain";
import { buildReport } from "./report";
import { makePage } from "./test-fixtures";
import { fakeProvider, setFakeResponse } from "@/lib/ai/generator";

// A deficient page yields at least one prioritized fix for the fallback to use.
const report = buildReport(
  makePage({
    renderedText: "Short body text.",
    jsonLdBlocks: [],
    hasServerRenderedContent: false,
    lastModified: null,
  }),
);

beforeEach(() => {
  setFakeResponse("{}");
  vi.stubEnv("GEMINI_API_KEY", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
  setFakeResponse("{}");
});

describe("explainReport", () => {
  it("returns a deterministic fallback when no provider is configured", async () => {
    const text = await explainReport(report); // default gemini provider, no key
    expect(text).toContain(`${report.ai.total}/100`);
    expect(text).toContain(`${report.traditional.total}/100`);
    expect(text.length).toBeGreaterThan(0);
    // Fallback is deterministic across calls.
    expect(await explainReport(report)).toBe(text);
  });

  it("returns the LLM narrative when a provider is configured", async () => {
    setFakeResponse("Your site is off to a good start.");
    const text = await explainReport(report, { provider: fakeProvider() });
    expect(text).toBe("Your site is off to a good start.");
  });

  it("falls back deterministically when the LLM call fails", async () => {
    setFakeResponse(null); // forces the fake provider to throw
    const text = await explainReport(report, { provider: fakeProvider() });
    expect(text).toContain(`${report.ai.total}/100`);
  });
});
