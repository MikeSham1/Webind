import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenAI, ThinkingLevel } from "@google/genai";
import { BASE_GEMINI_MODEL, geminiApiKey } from "../ai/gemini";
import { logInfo } from "../log";
import type { AnswerEngine } from "./types";

/**
 * Pluggable answer-engine providers for keyword-visibility probing.
 *
 * Claude and Gemini are fully implemented here. Claude uses Anthropic's
 * server-side web-search tool; Gemini uses Google Search grounding through the
 * Gemini Developer API. OpenAI/ChatGPT, Perplexity, and Google organic /
 * AI-Overviews via the SERPAPI slot remain honest stubs: inert without a key,
 * and a clearly-marked "not implemented" error when a key is present, which
 * the orchestrator catches and degrades to an unknown verdict.
 *
 * Claude model/tool versions match the citation checker:
 * `claude-opus-4-8`, adaptive thinking, `web_search_20260209`.
 */

const MODEL = "claude-opus-4-8";

/** The raw verdict a provider returns, before it is scored. */
export interface ProbeVerdict {
  present: boolean | null;
  prominence: number | null;
  competitors: string[];
  evidence: string | null;
}

export interface ProbeContext {
  domain: string;
  brandName: string;
}

/**
 * A provider must not read env at module load — `isConfigured()` is consulted
 * per call so tests can stub the environment.
 */
export interface VisibilityProvider {
  readonly engine: AnswerEngine;
  isConfigured(): boolean;
  probe(keyword: string, ctx: ProbeContext): Promise<ProbeVerdict>;
}

/**
 * The unbiased probe prompt, shared by every provider: answer the user's real
 * query WITHOUT naming the brand we're measuring, so the model isn't primed to
 * surface it. The brand is then detected deterministically in the answer.
 */
function buildProbePrompt(keyword: string): string {
  return (
    `A user asks an AI assistant: "${keyword}".\n\n` +
    `Using web search, answer exactly as you would for that user — recommend ` +
    `the best brands, products, or sources based on real, independent ` +
    `coverage. Then, on a FINAL line, list the specific brands, products, or ` +
    `websites your answer recommends or cites, most important first:\n` +
    `SOURCES: <comma-separated brands or domains, in order, or none>`
  );
}

// --- Claude provider (fully implemented) ------------------------------------

const WEB_SEARCH_TOOL = {
  type: "web_search_20260209",
  name: "web_search",
  max_uses: 5,
} as const;

const claudeProvider: VisibilityProvider = {
  engine: "claude",
  isConfigured: () => Boolean(process.env.ANTHROPIC_API_KEY),
  async probe(keyword, ctx) {
    const client = new Anthropic();

    // Unbiased probe (see buildProbePrompt): the brand is never named, so a
    // "present" verdict reflects the model surfacing it on its own.
    const prompt = buildProbePrompt(keyword);

    // Server-side web search runs an internal loop; a "pause_turn" means we
    // must resend to let it continue. Bound the continuations.
    const startedAt = Date.now();
    let inputTokens = 0;
    let outputTokens = 0;

    const messages: Anthropic.MessageParam[] = [
      { role: "user", content: prompt },
    ];
    let response = await client.messages.create({
      model: MODEL,
      max_tokens: 2048,
      thinking: { type: "adaptive" },
      output_config: { effort: "low" },
      tools: [WEB_SEARCH_TOOL],
      messages,
    });
    inputTokens += response.usage?.input_tokens ?? 0;
    outputTokens += response.usage?.output_tokens ?? 0;

    for (let i = 0; i < 4 && response.stop_reason === "pause_turn"; i++) {
      messages.push({ role: "assistant", content: response.content });
      response = await client.messages.create({
        model: MODEL,
        max_tokens: 2048,
        thinking: { type: "adaptive" },
        output_config: { effort: "low" },
        tools: [WEB_SEARCH_TOOL],
        messages,
      });
      inputTokens += response.usage?.input_tokens ?? 0;
      outputTokens += response.usage?.output_tokens ?? 0;
    }

    logInfo("ai_call.ok", {
      provider: "anthropic",
      purpose: "visibility_probe",
      model: MODEL,
      inputTokens,
      outputTokens,
      durationMs: Date.now() - startedAt,
    });

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n");

    return detectVisibility(text, ctx);
  },
};

/**
 * Deterministically judge visibility from an UNBIASED answer: parse the ranked
 * SOURCES the model recommended, then detect the target brand/domain in that
 * list (or in the prose). Prominence comes from the brand's rank, competitors
 * are the other recommendations. Because the probe never named the brand, a
 * "present" verdict reflects the model surfacing it on its own.
 */
export function detectVisibility(text: string, ctx: ProbeContext): ProbeVerdict {
  const sourcesMatch = /SOURCES:\s*([^\n]*)/i.exec(text);
  const answer = sourcesMatch ? text.slice(0, sourcesMatch.index) : text;
  const sources = (sourcesMatch?.[1] ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((s) => !/^none\b/i.test(s))
    .slice(0, 12);

  const brand = ctx.brandName.trim().toLowerCase();
  const domain = ctx.domain.trim().toLowerCase().replace(/^www\./, "");
  const hostCore = domain.split(".")[0];
  const matches = (s: string): boolean => {
    const l = s.toLowerCase();
    return (
      (brand.length > 2 && l.includes(brand)) ||
      l.includes(domain) ||
      (hostCore.length > 2 && l.includes(hostCore))
    );
  };

  const rank = sources.findIndex(matches);
  const inAnswer = matches(answer);
  const gotAnything = sources.length > 0 || answer.trim().length > 0;

  let present: boolean | null;
  if (rank >= 0 || inAnswer) present = true;
  else if (gotAnything) present = false;
  else present = null;

  let prominence: number | null = null;
  if (present) {
    prominence =
      rank >= 0 ? Math.round(100 - (rank * 90) / Math.max(sources.length, 1)) : 35;
  }

  const competitors = sources.filter((_, i) => i !== rank).slice(0, 8);

  let evidence: string;
  if (present) {
    evidence =
      rank >= 0
        ? `Recommended at rank ${rank + 1} of ${sources.length}.`
        : "Named in the answer but not among the ranked recommendations.";
  } else if (present === false) {
    evidence = sources.length
      ? `Not recommended; ${sources.slice(0, 3).join(", ")} surfaced instead.`
      : "The answer recommended nothing identifiable.";
  } else {
    evidence = "No answer returned.";
  }

  return { present, prominence, competitors, evidence };
}

// --- Gemini provider (fully implemented) ------------------------------------

const geminiProvider: VisibilityProvider = {
  engine: "gemini",
  isConfigured: () => geminiApiKey().length > 0,
  async probe(keyword, ctx) {
    const model = process.env.GEMINI_VISIBILITY_MODEL || BASE_GEMINI_MODEL;
    const startedAt = Date.now();
    const ai = new GoogleGenAI({ apiKey: geminiApiKey() });

    const response = await ai.models.generateContent({
      model,
      contents: buildProbePrompt(keyword),
      config: {
        // Ground the answer in real Google Search results, the same way the
        // Claude probe uses live web search. LOW thinking keeps it a fast draft.
        tools: [{ googleSearch: {} }],
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        maxOutputTokens: 2048,
      },
    });

    const grounding = response.candidates?.[0]?.groundingMetadata;
    logInfo("ai_call.ok", {
      provider: "gemini",
      purpose: "visibility_probe",
      model,
      inputTokens: response.usageMetadata?.promptTokenCount ?? 0,
      outputTokens: response.usageMetadata?.candidatesTokenCount ?? 0,
      durationMs: Date.now() - startedAt,
      groundingQueries: grounding?.webSearchQueries?.length ?? 0,
      groundingChunks: grounding?.groundingChunks?.length ?? 0,
    });

    return detectVisibility(response.text ?? "", ctx);
  },
};

// --- Stub providers ---------------------------------------------------------
//
// Intentionally NOT implemented against a guessed request/response shape. Each
// reports `configured: false` when its key is absent; when the key IS present
// it throws a clearly-marked error that the orchestrator catches and degrades
// to an unknown verdict.

function stubProvider(
  engine: AnswerEngine,
  envKey: string,
  label: string,
): VisibilityProvider {
  return {
    engine,
    isConfigured: () => Boolean(process.env[envKey]),
    async probe() {
      throw new Error(`${label} visibility provider is not yet implemented.`);
    },
  };
}

export const PROVIDERS: VisibilityProvider[] = [
  claudeProvider,
  geminiProvider,
  stubProvider("openai", "OPENAI_API_KEY", "OpenAI / ChatGPT"),
  stubProvider("perplexity", "PERPLEXITY_API_KEY", "Perplexity"),
  stubProvider("google", "SERPAPI_API_KEY", "Google SERP"),
];
