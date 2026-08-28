import { GoogleGenAI, ThinkingLevel } from "@google/genai";
import { logInfo } from "../log";
import type { AiProvider, GenerateRequest, GenerateResult } from "./types";

/**
 * Gemini generator adapter (default: gemini-3.7-flash).
 *
 * Notes grounded in current Google guidance:
 *  - No temperature / top_p / top_k on the 3.7 default path.
 *  - Base 3.7 defaults to MEDIUM thinking. It handles conversational planning,
 *    clarification, and untuned drafting where stronger reasoning is useful.
 *  - Supervised-tuned Gemini 3+ models default to MINIMAL thinking because the
 *    tuned task behavior is learned from examples rather than hidden reasoning.
 *    GEMINI_THINKING_LEVEL can override either default.
 *  - JSON mode uses responseMimeType. Controlled generation can reduce quality
 *    on tuned models, so content writing keeps free-text Markdown output.
 */

const DEFAULT_MODEL = "gemini-3.7-flash";

function thinkingLevel(isExplicitModel: boolean): ThinkingLevel {
  const fallback = isExplicitModel ? "minimal" : "medium";
  const raw = (process.env.GEMINI_THINKING_LEVEL ?? fallback).toUpperCase();
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
  return process.env.GEMINI_GENERATOR_MODEL || DEFAULT_MODEL;
}

/**
 * @param modelId Optional model override, such as a supervised-tuned content
 *   writer endpoint. Falls back to GEMINI_GENERATOR_MODEL, then the default.
 */
export function geminiProvider(modelId?: string): AiProvider {
  const model = modelId || geminiModelId();
  const isExplicitModel = Boolean(modelId);
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
          thinkingConfig: { thinkingLevel: thinkingLevel(isExplicitModel) },
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
