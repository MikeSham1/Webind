import { createHash } from "node:crypto";
import { logInfo, logWarn } from "../log";
import { geminiProvider } from "./gemini";
import { anthropicProvider } from "./anthropic";
import type { AiProvider, GenerateRequest, GenerateResult } from "./types";

/**
 * Provider selection + a safe `generate()` wrapper.
 *
 * The active generator is `FIX_GENERATOR_PROVIDER` (default "gemini"). A
 * request against an unconfigured or failing provider never throws into the
 * caller — it returns a `fallback: true` result so the report/fix path degrades
 * gracefully (Governing principle 8). Callers MUST check `.fallback` and not
 * treat a fallback as a real generation.
 */

export function selectProvider(name?: string): AiProvider {
  const choice = (name ?? process.env.FIX_GENERATOR_PROVIDER ?? "gemini").toLowerCase();
  switch (choice) {
    case "anthropic":
    case "claude":
      return anthropicProvider();
    case "fake":
      return fakeProvider();
    case "gemini":
    default:
      return geminiProvider();
  }
}

function fallbackResult(
  provider: AiProvider,
  req: GenerateRequest,
  error: string,
): GenerateResult {
  return {
    provider: provider.name,
    model: provider.model,
    text: "",
    inputTokens: 0,
    outputTokens: 0,
    durationMs: 0,
    purpose: req.purpose,
    fallback: true,
    error,
  };
}

// --- Response cache -----------------------------------------------------------
//
// Re-running a report on an unchanged page builds a byte-identical prompt, and
// paying the model again for the same answer is pure waste. Requests that opt
// in with `cacheTtlMs` are keyed on everything that shapes the answer; the
// in-flight promise is stored too, so a double-submitted form makes one call.
// Per-process and bounded: a cold instance simply pays once more.

/** Most cached answers held at once; the oldest is evicted past this. */
const MAX_CACHE_ENTRIES = 500;

const responseCache = new Map<string, { expiresAt: number; result: Promise<GenerateResult> }>();

function cacheKey(provider: AiProvider, req: GenerateRequest): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        provider.name,
        provider.model,
        req.system,
        req.prompt,
        req.json ?? false,
        req.thinkingLevel ?? null,
        req.maxOutputTokens ?? null,
      ]),
    )
    .digest("hex");
}

/** Test hook: drop every cached answer. */
export function clearGenerateCache(): void {
  responseCache.clear();
}

export async function generate(
  req: GenerateRequest,
  opts: { provider?: AiProvider } = {},
): Promise<GenerateResult> {
  const provider = opts.provider ?? selectProvider();
  if (!provider.isConfigured()) {
    return fallbackResult(provider, req, `${provider.name} is not configured`);
  }
  // The fake provider's answer is mutable test state, so it is never cached;
  // grounded answers depend on live search results, so neither are they.
  const cacheable =
    (req.cacheTtlMs ?? 0) > 0 && !req.grounded && provider.name !== "fake";
  if (!cacheable) return callProvider(provider, req);

  const key = cacheKey(provider, req);
  const now = Date.now();
  const hit = responseCache.get(key);
  if (hit && hit.expiresAt > now) {
    const result = await hit.result;
    logInfo("ai_call.cache_hit", { provider: provider.name, purpose: req.purpose });
    return { ...result, cached: true, inputTokens: 0, outputTokens: 0, thinkingTokens: 0, durationMs: 0 };
  }

  const result = callProvider(provider, req);
  responseCache.delete(key);
  responseCache.set(key, { expiresAt: now + req.cacheTtlMs!, result });
  if (responseCache.size > MAX_CACHE_ENTRIES) {
    responseCache.delete(responseCache.keys().next().value!);
  }
  const settled = await result;
  // Only a real answer is worth reusing; a failure should be retried next time.
  if (settled.fallback || !settled.text.trim()) {
    if (responseCache.get(key)?.result === result) responseCache.delete(key);
  }
  return settled;
}

async function callProvider(
  provider: AiProvider,
  req: GenerateRequest,
): Promise<GenerateResult> {
  try {
    return await provider.generate(req);
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    logWarn("ai_call.error", {
      provider: provider.name,
      purpose: req.purpose,
      model: provider.model,
      error,
    });
    return fallbackResult(provider, req, error);
  }
}

// --- Deterministic fake provider (tests only) -------------------------------
//
// No unit test may require a live Gemini/Claude call. Tests set the canned
// response and assert on the plumbing. `setFakeResponse(null)` makes the fake
// throw, to exercise the fallback path.

let fakeResponse: string | null = "{}";

export function setFakeResponse(text: string | null): void {
  fakeResponse = text;
}

export function fakeProvider(): AiProvider {
  return {
    name: "fake",
    model: "fake-1",
    isConfigured: () => true,
    async generate(req: GenerateRequest): Promise<GenerateResult> {
      if (fakeResponse === null) throw new Error("fake provider: forced failure");
      return {
        provider: "fake",
        model: "fake-1",
        text: fakeResponse,
        inputTokens: 0,
        outputTokens: 0,
        durationMs: 0,
        purpose: req.purpose,
        fallback: false,
      };
    },
  };
}
