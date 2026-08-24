import { logWarn } from "../log";
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

export async function generate(
  req: GenerateRequest,
  opts: { provider?: AiProvider } = {},
): Promise<GenerateResult> {
  const provider = opts.provider ?? selectProvider();
  if (!provider.isConfigured()) {
    return fallbackResult(provider, req, `${provider.name} is not configured`);
  }
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
