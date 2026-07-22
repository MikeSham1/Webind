import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { checkAiCitations } from "./ai-citations";

// Single shared mock for the Anthropic SDK's messages.create.
const create = vi.fn();

vi.mock("@anthropic-ai/sdk", () => {
  class MockAnthropic {
    messages = { create };
  }
  return { default: MockAnthropic };
});

beforeEach(() => {
  create.mockReset();
  // Start from a clean, key-free environment; individual tests opt in.
  vi.stubEnv("ANTHROPIC_API_KEY", "");
  vi.stubEnv("PERPLEXITY_API_KEY", "");
  vi.stubEnv("OPENAI_API_KEY", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("checkAiCitations", () => {
  it("reports nothing configured when no API keys are present", async () => {
    const result = await checkAiCitations("example.com");

    expect(result.configured).toBe(false);
    expect(result.brandMentionScore).toBeNull();
    expect(result.engines).toHaveLength(3);
    for (const e of result.engines) {
      expect(e.configured).toBe(false);
      expect(e.cited).toBeNull();
      expect(e.evidence).toBeNull();
    }
    expect(create).not.toHaveBeenCalled();
  });

  it("parses the Claude verdict and computes a score", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    create.mockResolvedValue({
      stop_reason: "end_turn",
      content: [
        {
          type: "text",
          text: "Found coverage.\nCITED: yes\nEVIDENCE: Listed on Wikipedia and industry press.",
        },
      ],
    });

    const result = await checkAiCitations("example.com", {
      brandName: "Example",
    });

    const claude = result.engines.find((e) => e.engine === "claude");
    expect(claude).toBeDefined();
    expect(claude!.configured).toBe(true);
    expect(claude!.cited).toBe(true);
    expect(claude!.evidence).toContain("Wikipedia");

    // Only Claude is configured; it cited -> 1/1 = 100.
    expect(result.configured).toBe(true);
    expect(result.brandMentionScore).toBe(100);
    expect(create).toHaveBeenCalledOnce();
  });

  it("computes a not-cited score of 0 from a 'no' verdict", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    create.mockResolvedValue({
      stop_reason: "end_turn",
      content: [{ type: "text", text: "CITED: no\nEVIDENCE: No independent sources found." }],
    });

    const result = await checkAiCitations("example.com");

    const claude = result.engines.find((e) => e.engine === "claude")!;
    expect(claude.cited).toBe(false);
    expect(result.brandMentionScore).toBe(0);
  });

  it("never throws on API failure — degrades to cited:null and score null", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    create.mockRejectedValue(new Error("network down"));

    const result = await checkAiCitations("example.com");

    const claude = result.engines.find((e) => e.engine === "claude")!;
    expect(claude.configured).toBe(true);
    expect(claude.cited).toBeNull();
    expect(claude.evidence).toContain("network down");
    // A failed check is "unknown", not "not cited": score stays null so
    // enrichment leaves the report untouched rather than zeroing it.
    expect(result.configured).toBe(true);
    expect(result.brandMentionScore).toBeNull();
  });

  it("degrades a configured-but-stubbed engine safely (score null, not 0)", async () => {
    vi.stubEnv("PERPLEXITY_API_KEY", "pplx-key");

    const result = await checkAiCitations("example.com");

    const pplx = result.engines.find((e) => e.engine === "perplexity")!;
    expect(pplx.configured).toBe(true);
    expect(pplx.cited).toBeNull();
    expect(pplx.evidence).toContain("not yet implemented");
    // Configured but no definite verdict -> unknown, not a punitive 0.
    expect(result.configured).toBe(true);
    expect(result.brandMentionScore).toBeNull();
  });

  it("a definite 'no' from a failed engine's peer still scores from the definite one", async () => {
    // Claude configured + gives a definite false; Perplexity stub throws.
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    vi.stubEnv("PERPLEXITY_API_KEY", "pplx-key");
    create.mockResolvedValue({
      stop_reason: "end_turn",
      content: [{ type: "text", text: "CITED: no\nEVIDENCE: none found." }],
    });

    const result = await checkAiCitations("example.com");

    // Only Claude produced a definite verdict (false) -> 0/1 = 0.
    expect(result.brandMentionScore).toBe(0);
  });
});
