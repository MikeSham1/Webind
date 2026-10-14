import { describe, it, expect, beforeEach, vi } from "vitest";
import { clearGenerateCache, generate } from "./generator";
import type { AiProvider, GenerateRequest } from "./types";

/** A configured stub that counts calls and can be told to fail. */
function stubProvider(answer: () => string | Error): AiProvider & { calls: number } {
  const p = {
    name: "gemini" as const,
    model: "stub-1",
    calls: 0,
    isConfigured: () => true,
    generate: vi.fn(async (req: GenerateRequest) => {
      p.calls++;
      const a = answer();
      if (a instanceof Error) throw a;
      return {
        provider: "gemini" as const,
        model: "stub-1",
        text: a,
        inputTokens: 100,
        outputTokens: 20,
        durationMs: 5,
        purpose: req.purpose,
        fallback: false,
      };
    }),
  };
  return p;
}

const req = (over: Partial<GenerateRequest> = {}): GenerateRequest => ({
  system: "sys",
  prompt: "same prompt",
  purpose: "test",
  cacheTtlMs: 60_000,
  ...over,
});

describe("generate response cache", () => {
  beforeEach(() => clearGenerateCache());

  it("reuses an identical request's answer without another call", async () => {
    const provider = stubProvider(() => "answer");
    const first = await generate(req(), { provider });
    const second = await generate(req(), { provider });
    expect(provider.calls).toBe(1);
    expect(first.cached).toBeUndefined();
    expect(second).toMatchObject({ text: "answer", cached: true, inputTokens: 0, outputTokens: 0 });
  });

  it("makes one call for concurrent identical requests", async () => {
    const provider = stubProvider(() => "answer");
    await Promise.all([generate(req(), { provider }), generate(req(), { provider })]);
    expect(provider.calls).toBe(1);
  });

  it("treats a different prompt as a different request", async () => {
    const provider = stubProvider(() => "answer");
    await generate(req(), { provider });
    await generate(req({ prompt: "other prompt" }), { provider });
    expect(provider.calls).toBe(2);
  });

  it("does not cache failures, so the next call retries", async () => {
    let fail = true;
    const provider = stubProvider(() => (fail ? new Error("503") : "answer"));
    expect((await generate(req(), { provider })).fallback).toBe(true);
    fail = false;
    expect((await generate(req(), { provider })).text).toBe("answer");
    expect(provider.calls).toBe(2);
  });

  it("never caches without opt-in, or for grounded requests", async () => {
    const provider = stubProvider(() => "answer");
    await generate(req({ cacheTtlMs: undefined }), { provider });
    await generate(req({ cacheTtlMs: undefined }), { provider });
    await generate(req({ grounded: true }), { provider });
    await generate(req({ grounded: true }), { provider });
    expect(provider.calls).toBe(4);
  });

  it("expires entries after the TTL", async () => {
    vi.useFakeTimers();
    try {
      const provider = stubProvider(() => "answer");
      await generate(req(), { provider });
      vi.advanceTimersByTime(60_001);
      await generate(req(), { provider });
      expect(provider.calls).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
