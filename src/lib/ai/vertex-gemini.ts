import { GoogleGenAI, ThinkingLevel } from "@google/genai";
import { logInfo } from "../log";
import type { AiProvider, GenerateRequest, GenerateResult } from "./types";

interface VertexEndpointTarget {
  project: string;
  location: string;
  endpoint: string;
}

/**
 * Vertex tuned-model endpoint names are returned by a completed tuning job as:
 * projects/{project}/locations/{location}/endpoints/{endpoint}
 */
export function parseVertexEndpoint(model: string): VertexEndpointTarget | null {
  const match = model
    .trim()
    .match(/^projects\/([^/]+)\/locations\/([^/]+)\/endpoints\/([^/]+)$/);
  if (!match) return null;
  return { project: match[1], location: match[2], endpoint: model.trim() };
}

function thinkingLevel(): ThinkingLevel {
  const raw = (process.env.CONTENT_WRITER_THINKING_LEVEL ?? "minimal").toUpperCase();
  switch (raw) {
    case "LOW":
      return ThinkingLevel.LOW;
    case "MEDIUM":
      return ThinkingLevel.MEDIUM;
    case "HIGH":
      return ThinkingLevel.HIGH;
    default:
      return ThinkingLevel.MINIMAL;
  }
}

function inlineGoogleAuthOptions() {
  const raw = process.env.VERTEX_SERVICE_ACCOUNT_JSON?.trim();
  if (!raw) return undefined;
  // Let an invalid secret fail inside generate(); the provider-neutral router
  // catches that error and safely falls back instead of crashing the request.
  return { credentials: JSON.parse(raw) };
}

/**
 * Provider for a supervised-tuned Gemini endpoint hosted on Vertex AI.
 *
 * This is intentionally separate from geminiProvider(): GEMINI_API_KEY is a
 * Gemini Developer API credential and cannot authenticate a Vertex endpoint.
 * Vertex uses Google Cloud authentication (ADC / workload identity / service
 * account credentials). For hosts where mounting an ADC file is awkward,
 * VERTEX_SERVICE_ACCOUNT_JSON can hold the service-account JSON server-side.
 */
export function vertexGeminiProvider(model: string): AiProvider {
  const target = parseVertexEndpoint(model);
  return {
    name: "gemini",
    model,
    isConfigured: () => target !== null,
    async generate(req: GenerateRequest): Promise<GenerateResult> {
      if (!target) throw new Error("CONTENT_WRITER_VERTEX_ENDPOINT is not a valid Vertex endpoint resource name.");

      const startedAt = Date.now();
      const googleAuthOptions = inlineGoogleAuthOptions();
      const ai = new GoogleGenAI({
        vertexai: true,
        project: target.project,
        location: target.location,
        ...(googleAuthOptions ? { googleAuthOptions } : {}),
      });

      const response = await ai.models.generateContent({
        model: target.endpoint,
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
        transport: "vertex",
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
