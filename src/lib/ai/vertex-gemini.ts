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

/**
 * Provider for a supervised-tuned Gemini endpoint hosted on Vertex AI.
 *
 * This is intentionally separate from geminiProvider(): GEMINI_API_KEY is a
 * Gemini Developer API credential and does not authenticate a normal Vertex AI
 * project endpoint. Vertex uses Google Cloud Application Default Credentials
 * (service account / workload identity / GOOGLE_APPLICATION_CREDENTIALS).
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
      const ai = new GoogleGenAI({
        vertexai: true,
        project: target.project,
        location: target.location,
      });

      const response = await ai.models.generateContent({
        model: target.endpoint,
        contents: req.prompt,
        config: {
          systemInstruction: req.system,
          maxOutputTokens: req.maxOutputTokens ?? 2048,
          thinkingConfig: { thinkingLevel: thinkingLevel() },
          // Keep the tuned writer bound to the supplied brief. Live-search tool
          // support can differ for tuned endpoints, and attaching search would
          // weaken the training/inference grounding contract.
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
