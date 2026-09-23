import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The SDK is mocked so these tests never make a network call.
const { generateContent } = vi.hoisted(() => ({ generateContent: vi.fn() }));
vi.mock("@google/genai", () => ({
  GoogleGenAI: class {
    models = { generateContent };
  },
  ThinkingLevel: { MINIMAL: "MINIMAL", LOW: "LOW", MEDIUM: "MEDIUM", HIGH: "HIGH" },
}));

import { geminiApiKey, geminiKeyDiagnostics, geminiProvider } from "./gemini";

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

describe("gemini adapter: API key normalization", () => {
  const original = process.env.GEMINI_API_KEY;
  afterEach(() => {
    if (original === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = original;
  });

  it("strips the quotes a dashboard paste leaves around the value", () => {
    // Railway's raw editor keeps the quotes from GEMINI_API_KEY="AIza…", and
    // they end up inside the value — a set-but-rejected key.
    process.env.GEMINI_API_KEY = '"AIzaSyTESTKEYTESTKEYTESTKEYTESTKEYTEST"';
    expect(geminiApiKey()).toBe("AIzaSyTESTKEYTESTKEYTESTKEYTESTKEYTEST");

    process.env.GEMINI_API_KEY = "'AIzaSyTESTKEYTESTKEYTESTKEYTESTKEYTEST'";
    expect(geminiApiKey()).toBe("AIzaSyTESTKEYTESTKEYTESTKEYTESTKEYTEST");
  });

  it("strips the newline a copy-paste drags in", () => {
    process.env.GEMINI_API_KEY = "  AIzaSyTESTKEYTESTKEYTESTKEYTESTKEYTEST\n";
    expect(geminiApiKey()).toBe("AIzaSyTESTKEYTESTKEYTESTKEYTESTKEYTEST");
  });

  it("leaves a clean key untouched and treats a blank one as absent", () => {
    process.env.GEMINI_API_KEY = "AIzaSyCLEAN";
    expect(geminiApiKey()).toBe("AIzaSyCLEAN");

    process.env.GEMINI_API_KEY = "   ";
    expect(geminiApiKey()).toBe("");
    expect(geminiProvider().isConfigured()).toBe(false);
  });

  it("uses the cleaned key for the actual call, not the raw value", async () => {
    process.env.GEMINI_API_KEY = '"AIzaSyDIRTY"\n';
    generateContent.mockResolvedValue({
      text: "ok",
      candidates: [{ finishReason: "STOP" }],
      usageMetadata: {},
    });

    // A whitespace-only or quoted key must not read as configured-and-broken.
    expect(geminiProvider().isConfigured()).toBe(true);
    const result = await geminiProvider().generate(req);
    expect(result.fallback).toBe(false);
  });

  it("reports key shape for diagnosis without exposing the key", () => {
    process.env.GEMINI_API_KEY = '"AIzaSyTESTKEY"\n';
    const d = geminiKeyDiagnostics();

    expect(d.present).toBe(true);
    expect(d.looksLikeGoogleKey).toBe(true);
    expect(d.hadSurroundingQuotes).toBe(true);
    expect(d.hadEdgeWhitespace).toBe(true);
    expect(d.length).toBe("AIzaSyTESTKEY".length);
    // Nothing in the payload may contain the secret itself.
    expect(JSON.stringify(d)).not.toContain("AIzaSyTESTKEY");
  });

  it("flags a credential that isn't a Gemini Developer API key", () => {
    process.env.GEMINI_API_KEY = "ya29.a0AfB_oauth-token";
    expect(geminiKeyDiagnostics().looksLikeGoogleKey).toBe(false);
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
