import { GoogleGenAI, ThinkingLevel } from "@google/genai";
import { logInfo } from "../log";
import type { AiProvider, GenerateRequest, GenerateResult } from "./types";

/**
 * Gemini Developer API adapter (default: gemini-3.7-flash).
 *
 * This adapter is intentionally API-key-only. Vertex tuned endpoints belong in
 * vertex-gemini.ts and must never be passed through GEMINI_API_KEY.
 *
 * Notes grounded in current Google guidance:
 *  - No temperature / top_p / top_k on the 3.7 path.
 *  - Untuned 3.7 defaults to MEDIUM thinking for planning and generation.
 *  - GEMINI_THINKING_LEVEL can override the Developer API default when an
 *    existing non-content caller deliberately needs a different level.
 *  - JSON mode uses responseMimeType.
 */

export const BASE_GEMINI_MODEL = "gemini-3.7-flash";

function thinkingLevel(): ThinkingLevel {
  const raw = (process.env.GEMINI_THINKING_LEVEL ?? "medium").toUpperCase();
  switch (raw) {
    case "MINIMAL":
      return ThinkingLevel.MINIMAL;
    case "LOW":
      return ThinkingLevel.LOW;
    case "HIGH":
      return ThinkingLevel.HIGH;
    default:
      return ThinkingLevel.MEDIUM;
  }
}

export function geminiModelId(): string {
  return process.env.GEMINI_GENERATOR_MODEL || BASE_GEMINI_MODEL;
}

/**
 * Generic Gemini Developer API provider used by existing fix-generation code.
 * An optional model override is still supported for those existing callers;
 * it does not imply a tuned model or change the default thinking level.
 */
export function geminiProvider(modelId?: string): AiProvider {
  const model = modelId || geminiModelId();
  return {
    name: "gemini",
    model,
    isConfigured: () => Boolean(process.env.GEMINI_API_KEY),
    async generate(req: GenerateRequest): Promise<GenerateResult> {
      const startedAt = Date.now();
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const response = await ai.models.generateContent({
        model,
        contents: req.prompt,
        config: {
          systemInstruction: req.system,
          maxOutputTokens: req.maxOutputTokens ?? 2048,
          thinkingConfig: { thinkingLevel: thinkingLevel() },
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
 * Content-specific base provider. It is deliberately pinned to 3.7 so an
 * unrelated GEMINI_GENERATOR_MODEL override cannot silently change the planner,
 * synthetic teacher, or tuned-writer fallback model.
 */
export function gemini37Provider(): AiProvider {
  return geminiProvider(BASE_GEMINI_MODEL);
}
