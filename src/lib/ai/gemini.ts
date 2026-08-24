import { GoogleGenAI, ThinkingLevel } from "@google/genai";
import { logInfo } from "../log";
import type { AiProvider, GenerateRequest, GenerateResult } from "./types";

/**
 * Gemini generator adapter (default: gemini-3.7-flash).
 *
 * Notes grounded in the current @google/genai SDK + Google's 3.7 guidance:
 *  - No temperature / top_p / top_k — Google says to drop those on 3.7 Flash.
 *  - Thinking is controlled by thinkingLevel; LOW is aimed at drafting/writing
 *    workloads like ours. Configurable via GEMINI_THINKING_LEVEL.
 *  - JSON mode uses responseMimeType. For a FUTURE tuned model, structured/
 *    response-schema output can hurt quality (structure isn't applied during
 *    tuning), so JSON mode is a per-request flag the router can turn off.
 */

const DEFAULT_MODEL = "gemini-3.7-flash";

function thinkingLevel(): ThinkingLevel {
  const raw = (process.env.GEMINI_THINKING_LEVEL ?? "low").toUpperCase();
  switch (raw) {
    case "MINIMAL":
      return ThinkingLevel.MINIMAL;
    case "MEDIUM":
      return ThinkingLevel.MEDIUM;
    case "HIGH":
      return ThinkingLevel.HIGH;
    default:
      return ThinkingLevel.LOW;
  }
}

export function geminiModelId(): string {
  return process.env.GEMINI_GENERATOR_MODEL || DEFAULT_MODEL;
}

export function geminiProvider(): AiProvider {
  const model = geminiModelId();
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
          ...(req.json ? { responseMimeType: "application/json" } : {}),
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
