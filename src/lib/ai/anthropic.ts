import Anthropic from "@anthropic-ai/sdk";
import { logInfo } from "../log";
import type { AiProvider, GenerateRequest, GenerateResult } from "./types";

/**
 * Anthropic (Claude) generator adapter — kept as an evaluated control in the
 * model bake-off, not deleted just because Gemini is the new default. Uses the
 * project's standard model + adaptive thinking (see the claude-api skill).
 */

const DEFAULT_MODEL = "claude-opus-4-8";

export function anthropicModelId(): string {
  return process.env.ANTHROPIC_GENERATOR_MODEL || DEFAULT_MODEL;
}

export function anthropicProvider(): AiProvider {
  const model = anthropicModelId();
  return {
    name: "anthropic",
    model,
    isConfigured: () => Boolean(process.env.ANTHROPIC_API_KEY),
    async generate(req: GenerateRequest): Promise<GenerateResult> {
      const startedAt = Date.now();
      const client = new Anthropic();
      const response = await client.messages.create({
        model,
        max_tokens: req.maxOutputTokens ?? 2048,
        thinking: { type: "adaptive" },
        system: req.json
          ? `${req.system}\n\nRespond with ONLY valid JSON — no prose, no code fences.`
          : req.system,
        messages: [{ role: "user", content: req.prompt }],
      });

      const durationMs = Date.now() - startedAt;
      const inputTokens = response.usage?.input_tokens ?? 0;
      const outputTokens = response.usage?.output_tokens ?? 0;
      const text = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("");

      logInfo("ai_call.ok", {
        provider: "anthropic",
        purpose: req.purpose,
        model,
        inputTokens,
        outputTokens,
        durationMs,
      });

      return {
        provider: "anthropic",
        model,
        text,
        inputTokens,
        outputTokens,
        durationMs,
        purpose: req.purpose,
        fallback: false,
      };
    },
  };
}
