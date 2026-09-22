import { beforeEach, describe, expect, it, vi } from "vitest";

// The SDK is mocked so these tests never make a network call.
const { generateContent } = vi.hoisted(() => ({ generateContent: vi.fn() }));
vi.mock("@google/genai", () => ({
  GoogleGenAI: class {
    models = { generateContent };
  },
  ThinkingLevel: { MINIMAL: "MINIMAL", LOW: "LOW", MEDIUM: "MEDIUM", HIGH: "HIGH" },
}));

import { geminiProvider } from "./gemini";

const req = { system: "s", prompt: "p", maxOutputTokens: 700, purpose: "content_plan" };

beforeEach(() => {
  generateContent.mockReset();
});

describe("gemini adapter: empty responses are failures, not silent successes", () => {
  it("treats a reasoning-exhausted (MAX_TOKENS, no text) response as a fallback", async () => {
    // The real-world planner bug: MEDIUM thinking spent the whole 700-token
    // budget before producing any visible text. The call returns 200 with an
    // empty string, which used to be handed back as a "successful" generation.
    generateContent.mockResolvedValue({
      text: "",
      candidates: [{ finishReason: "MAX_TOKENS" }],
      usageMetadata: {
        promptTokenCount: 120,
        candidatesTokenCount: 0,
        thoughtsTokenCount: 700,
      },
    });

    const result = await geminiProvider().generate(req);

    expect(result.fallback).toBe(true);
    expect(result.finishReason).toBe("MAX_TOKENS");
    // The error names the actual cause so it's diagnosable from logs.
    expect(result.error).toMatch(/maxOutputTokens/i);
    expect(result.error).toMatch(/reasoning/i);
  });

  it("flags an empty response with any other finish reason", async () => {
    generateContent.mockResolvedValue({
      text: "   ",
      candidates: [{ finishReason: "SAFETY" }],
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 0 },
    });

    const result = await geminiProvider().generate(req);
    expect(result.fallback).toBe(true);
    expect(result.error).toMatch(/SAFETY/);
  });
});

describe("gemini adapter: token accounting", () => {
  it("counts reasoning tokens as output (they are billed and spend the budget)", async () => {
    generateContent.mockResolvedValue({
      text: "Here is the plan.",
      candidates: [{ finishReason: "STOP" }],
      usageMetadata: {
        promptTokenCount: 50,
        candidatesTokenCount: 30,
        thoughtsTokenCount: 200,
      },
    });

    const result = await geminiProvider().generate(req);

    expect(result.fallback).toBe(false);
    expect(result.text).toBe("Here is the plan.");
    expect(result.inputTokens).toBe(50);
    // 30 visible + 200 reasoning — reporting only 30 under-states real cost.
    expect(result.outputTokens).toBe(230);
    expect(result.thinkingTokens).toBe(200);
  });

  it("works when the provider reports no reasoning tokens", async () => {
    generateContent.mockResolvedValue({
      text: "ok",
      candidates: [{ finishReason: "STOP" }],
      usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 7 },
    });

    const result = await geminiProvider().generate(req);
    expect(result.outputTokens).toBe(7);
    expect(result.thinkingTokens).toBe(0);
  });
});

describe("gemini adapter: per-request thinking level", () => {
  it("passes the request's thinkingLevel through to the SDK", async () => {
    generateContent.mockResolvedValue({
      text: "ok",
      candidates: [{ finishReason: "STOP" }],
      usageMetadata: {},
    });

    await geminiProvider().generate({ ...req, thinkingLevel: "low" });

    const config = generateContent.mock.calls[0][0].config;
    expect(config.thinkingConfig.thinkingLevel).toBe("LOW");
    expect(config.maxOutputTokens).toBe(700);
  });
});
