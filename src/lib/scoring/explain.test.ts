import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { explainReport } from "./explain";
import { buildReport } from "./report";
import { makePage } from "./test-fixtures";

const create = vi.fn();

vi.mock("@anthropic-ai/sdk", () => {
  class MockAnthropic {
    messages = { create };
  }
  return { default: MockAnthropic };
});

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
  create.mockReset();
  vi.stubEnv("ANTHROPIC_API_KEY", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("explainReport", () => {
  it("returns a deterministic fallback when no API key is set", async () => {
    const text = await explainReport(report);

    expect(create).not.toHaveBeenCalled();
    expect(text).toContain(`${report.ai.total}/100`);
    expect(text).toContain(`${report.traditional.total}/100`);
    // References the top fix deterministically.
    expect(text.length).toBeGreaterThan(0);
    // Fallback is deterministic across calls.
    expect(await explainReport(report)).toBe(text);
  });

  it("returns the mocked Claude narrative when the key is set", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    create.mockResolvedValue({
      content: [{ type: "text", text: "Your site is off to a good start." }],
    });

    const text = await explainReport(report);

    expect(create).toHaveBeenCalledOnce();
    expect(text).toBe("Your site is off to a good start.");
  });

  it("falls back deterministically when the API call throws", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    create.mockRejectedValue(new Error("boom"));

    const text = await explainReport(report);

    expect(text).toContain(`${report.ai.total}/100`);
  });
});
