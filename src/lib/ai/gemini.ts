import { GoogleGenAI, ThinkingLevel } from "@google/genai";
import { logInfo } from "../log";
import type { AiProvider, GenerateRequest, GenerateResult } from "./types";

/**
 * Gemini Developer API adapter (default: gemini-3.7-flash).
 *
 * This adapter is intentionally API-key-only. Vertex tuned endpoints belong in
 * vertex-gemini.ts and must never be passed through GEMINI_API_KEY.
 */

export const BASE_GEMINI_MODEL = "gemini-3.7-flash";

function envThinkingLevel(): ThinkingLevel {
  return toThinkingLevel(process.env.GEMINI_THINKING_LEVEL, ThinkingLevel.MEDIUM);
}

/** Map a string level to the SDK enum, falling back to `dflt`. */
function toThinkingLevel(raw: string | undefined, dflt: ThinkingLevel): ThinkingLevel {
  switch ((raw ?? "").toUpperCase()) {
    case "MINIMAL":
      return ThinkingLevel.MINIMAL;
    case "LOW":
      return ThinkingLevel.LOW;
    case "MEDIUM":
      return ThinkingLevel.MEDIUM;
    case "HIGH":
      return ThinkingLevel.HIGH;
    default:
      return dflt;
  }
}

export function geminiModelId(): string {
  return process.env.GEMINI_GENERATOR_MODEL || BASE_GEMINI_MODEL;
}

/**
 * Generic Gemini Developer API provider used by existing fix-generation code.
 * Existing GEMINI_GENERATOR_MODEL / GEMINI_THINKING_LEVEL behavior is preserved
 * for those callers.
 */
export function geminiProvider(
  modelId?: string,
  opts: { thinkingLevel?: ThinkingLevel } = {},
): AiProvider {
  const model = modelId || geminiModelId();
  const providerThinkingLevel = opts.thinkingLevel ?? envThinkingLevel();
  return {
    name: "gemini",
    model,
    isConfigured: () => Boolean(process.env.GEMINI_API_KEY),
    async generate(req: GenerateRequest): Promise<GenerateResult> {
      const startedAt = Date.now();
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      // A per-request level (e.g. "low" for quick narration) overrides the
      // provider default, so latency-sensitive tasks don't pay for MEDIUM thinking.
      const thinkingLevel = req.thinkingLevel
        ? toThinkingLevel(req.thinkingLevel, providerThinkingLevel)
        : providerThinkingLevel;
      const response = await ai.models.generateContent({
        model,
        contents: req.prompt,
        config: {
          systemInstruction: req.system,
          maxOutputTokens: req.maxOutputTokens ?? 2048,
          thinkingConfig: { thinkingLevel },
          ...(req.grounded ? { tools: [{ googleSearch: {} }] } : {}),
          ...(req.json && !req.grounded ? { responseMimeType: "application/json" } : {}),
        },
      });

      const durationMs = Date.now() - startedAt;
      const inputTokens = response.usageMetadata?.promptTokenCount ?? 0;
      const outputTokens = response.usageMetadata?.candidatesTokenCount ?? 0;

      logInfo("ai_call.ok", {
        provider: "gemini",
        purpose: req.purpose,
        model,
        inputTokens,
        outputTokens,
        durationMs,
      });

      return {
        provider: "gemini",
        model,
        text: response.text ?? "",
        inputTokens,
        outputTokens,
        durationMs,
        purpose: req.purpose,
        fallback: false,
      };
    },
  };
}

/**
 * Content-specific base provider. It is deliberately pinned to Gemini 3.7 with
 * MEDIUM thinking so stale generic generator overrides in an existing env file
 * cannot silently change the planner, synthetic teacher, or writer fallback.
 */
export function gemini37Provider(): AiProvider {
  return geminiProvider(BASE_GEMINI_MODEL, { thinkingLevel: ThinkingLevel.MEDIUM });
}
