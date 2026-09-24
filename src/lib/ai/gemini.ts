import { ApiError, GoogleGenAI, ThinkingLevel } from "@google/genai";
import { logInfo, logWarn } from "../log";
import type { AiProvider, GenerateRequest, GenerateResult } from "./types";

/**
 * Gemini Developer API adapter (default: gemini-3.6-flash).
 *
 * This adapter is intentionally API-key-only. Vertex tuned endpoints belong in
 * vertex-gemini.ts and must never be passed through GEMINI_API_KEY.
 */

// gemini-3.7-flash currently returns a consistent 503 "high demand" from the
// Developer API regardless of key/project, while Google's own 404 messages on
// deprecated models point callers at 3.6 — pinned here until 3.7 stabilizes.
export const BASE_GEMINI_MODEL = "gemini-3.6-flash";

/**
 * The API key, cleaned of the damage a dashboard paste does to it.
 *
 * A key can be present and still be rejected: Railway's raw-editor keeps the
 * quotes when you paste `GEMINI_API_KEY="AIza…"`, and copying from a terminal
 * or password manager routinely drags in a trailing newline or space. Either
 * way the characters end up inside the value, the Authorization header is
 * malformed, and Google answers "API key not valid" — while every
 * `isSet("GEMINI_API_KEY")` style check in the codebase reports it as
 * configured. Normalizing here fixes it once for every caller.
 */
export function geminiApiKey(): string {
  return normalizeKey(process.env.GEMINI_API_KEY);
}

function normalizeKey(raw: string | undefined): string {
  const trimmed = (raw ?? "").trim();
  const quoted =
    trimmed.length >= 2 &&
    ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'")));
  return quoted ? trimmed.slice(1, -1).trim() : trimmed;
}

/**
 * What's wrong with the key's *shape*, for the admin health endpoint. Reports
 * only structure — never the key, or any part of it — so it is safe to read
 * from a browser and paste into a bug report.
 */
export function geminiKeyDiagnostics(): {
  present: boolean;
  length: number;
  looksLikeGoogleKey: boolean;
  hadSurroundingQuotes: boolean;
  hadEdgeWhitespace: boolean;
} {
  const raw = process.env.GEMINI_API_KEY ?? "";
  const key = normalizeKey(raw);
  return {
    present: key.length > 0,
    length: key.length,
    // Gemini Developer API keys are issued with an "AIza" prefix. A key that
    // lacks it is usually a Vertex/OAuth credential pasted into the wrong slot.
    looksLikeGoogleKey: key.startsWith("AIza"),
    hadSurroundingQuotes: key !== raw.trim(),
    hadEdgeWhitespace: raw !== raw.trim(),
  };
}

/**
 * Google's own message on a 503 UNAVAILABLE reads "usually temporary...
 * please try again later" — so that's exactly what a genuinely transient
 * capacity blip (also seen as 429 RESOURCE_EXHAUSTED) gets here, before a
 * single bad moment surfaces to the user as "unavailable". Anything else
 * (bad key, bad request, model not found) rethrows immediately — retrying
 * those would just add latency to a call that was never going to succeed.
 */
async function withTransientRetry<T>(
  attempt: () => Promise<T>,
  delaysMs: number[] = [300, 900],
): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await attempt();
    } catch (err) {
      const retryable = err instanceof ApiError && (err.status === 503 || err.status === 429);
      if (!retryable || i >= delaysMs.length) throw err;
      await new Promise((resolve) => setTimeout(resolve, delaysMs[i]));
    }
  }
}

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
    isConfigured: () => geminiApiKey().length > 0,
    async generate(req: GenerateRequest): Promise<GenerateResult> {
      const startedAt = Date.now();
      const ai = new GoogleGenAI({ apiKey: geminiApiKey() });
      // A per-request level (e.g. "low" for quick narration) overrides the
      // provider default, so latency-sensitive tasks don't pay for MEDIUM thinking.
      const thinkingLevel = req.thinkingLevel
        ? toThinkingLevel(req.thinkingLevel, providerThinkingLevel)
        : providerThinkingLevel;
      const response = await withTransientRetry(() =>
        ai.models.generateContent({
          model,
          contents: req.prompt,
          config: {
            systemInstruction: req.system,
            maxOutputTokens: req.maxOutputTokens ?? 2048,
            thinkingConfig: { thinkingLevel },
            ...(req.grounded ? { tools: [{ googleSearch: {} }] } : {}),
            ...(req.json && !req.grounded ? { responseMimeType: "application/json" } : {}),
          },
        }),
      );

      const durationMs = Date.now() - startedAt;
      const inputTokens = response.usageMetadata?.promptTokenCount ?? 0;
      // Reasoning tokens are reported separately but are still generated output
      // and still spend `maxOutputTokens`, so they belong in the output count.
      const thinkingTokens = response.usageMetadata?.thoughtsTokenCount ?? 0;
      const outputTokens =
        (response.usageMetadata?.candidatesTokenCount ?? 0) + thinkingTokens;
      const finishReason = response.candidates?.[0]?.finishReason;
      const text = response.text ?? "";

      // An empty response is NOT a successful generation, even though the call
      // returned 200. The usual cause is the reasoning budget consuming all of
      // `maxOutputTokens` before any visible text is produced (finishReason
      // MAX_TOKENS) — previously this logged ai_call.ok and handed callers an
      // empty string, which surfaced as an unexplained "unavailable".
      if (!text.trim()) {
        const error =
          finishReason === "MAX_TOKENS"
            ? `empty response: maxOutputTokens (${req.maxOutputTokens ?? 2048}) exhausted, ${thinkingTokens} of it on reasoning — raise the budget or lower thinkingLevel`
            : `empty response (finishReason: ${finishReason ?? "unknown"})`;
        logWarn("ai_call.error", {
          provider: "gemini",
          purpose: req.purpose,
          model,
          inputTokens,
          outputTokens,
          thinkingTokens,
          finishReason,
          durationMs,
          error,
        });
        return {
          provider: "gemini",
          model,
          text: "",
          inputTokens,
          outputTokens,
          thinkingTokens,
          durationMs,
          purpose: req.purpose,
          fallback: true,
          finishReason,
          error,
        };
      }

      logInfo("ai_call.ok", {
        provider: "gemini",
        purpose: req.purpose,
        model,
        inputTokens,
        outputTokens,
        thinkingTokens,
        finishReason,
        durationMs,
      });

      return {
        provider: "gemini",
        model,
        text,
        inputTokens,
        outputTokens,
        thinkingTokens,
        durationMs,
        purpose: req.purpose,
        fallback: false,
        finishReason,
      };
    },
  };
}

/**
 * Content-specific base provider. It is deliberately pinned to BASE_GEMINI_MODEL
 * with MEDIUM thinking so stale generic generator overrides in an existing env
 * file cannot silently change the planner, synthetic teacher, or writer
 * fallback. Named for the model this was originally pinned to (3.7); the
 * pin itself — not that specific version — is what matters here.
 */
export function gemini37Provider(): AiProvider {
  return geminiProvider(BASE_GEMINI_MODEL, { thinkingLevel: ThinkingLevel.MEDIUM });
}
