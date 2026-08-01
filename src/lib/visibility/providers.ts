import Anthropic from "@anthropic-ai/sdk";
import type { AnswerEngine } from "./types";

/**
 * Pluggable answer-engine providers for keyword-visibility probing.
 *
 * Only the Claude provider is fully implemented — it uses the Anthropic
 * server-side web-search tool to judge, for a given query, whether the brand
 * would surface and who gets recommended instead. The others (OpenAI/ChatGPT,
 * Gemini, Perplexity, and Google organic/AI-Overviews via a SERP API) are
 * honest stubs: inert without a key, and a clearly-marked "not implemented"
 * error when a key is present, which the orchestrator catches and degrades to
 * an unknown verdict. Nothing here fabricates a result.
 *
 * Model and tool versions follow the `claude-api` skill and match the existing
 * citation checker: `claude-opus-4-8`, adaptive thinking, `web_search_20260209`.
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

    const prompt =
      `A user asks an AI assistant: "${keyword}".\n\n` +
      `Using web search, determine how a well-grounded answer to that query ` +
      `would treat the brand "${ctx.brandName}" (website: ${ctx.domain}). ` +
      `Judge whether that brand would be surfaced or recommended, how central ` +
      `it would be to the answer, and which other brands, products, or sources ` +
      `an answer would most likely cite instead. Base this on real, ` +
      `independent coverage — ignore the brand's own marketing pages.\n\n` +
      `End your reply with EXACTLY these four lines:\n` +
      `PRESENT: yes | no | unknown\n` +
      `PROMINENCE: <0-100, or n/a>\n` +
      `COMPETITORS: <comma-separated brands or domains cited instead, or none>\n` +
      `EVIDENCE: <one short sentence naming the strongest source or gap>`;

    // Server-side web search runs an internal loop; a "pause_turn" means we
    // must resend to let it continue. Bound the continuations.
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
    }

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n");

    return parseVerdict(text);
  },
};

/** Parse the PRESENT/PROMINENCE/COMPETITORS/EVIDENCE trailer from a reply. */
export function parseVerdict(text: string): ProbeVerdict {
  const presentMatch = /PRESENT:\s*(yes|no|unknown)/i.exec(text);
  const prominenceMatch = /PROMINENCE:\s*(\d{1,3}|n\/?a)/i.exec(text);
  const competitorsMatch = /COMPETITORS:\s*(.+)/i.exec(text);
  const evidenceMatch = /EVIDENCE:\s*([\s\S]+)/i.exec(text);

  let present: boolean | null = null;
  if (presentMatch) {
    const v = presentMatch[1].toLowerCase();
    if (v === "yes") present = true;
    else if (v === "no") present = false;
  }

  let prominence: number | null = null;
  if (present === true && prominenceMatch && !/n/i.test(prominenceMatch[1])) {
    const n = Number(prominenceMatch[1]);
    if (Number.isFinite(n)) prominence = Math.min(100, Math.max(0, n));
  }

  let competitors: string[] = [];
  if (competitorsMatch) {
    const raw = competitorsMatch[1].split("\n")[0].trim();
    if (raw && !/^none\b/i.test(raw)) {
      competitors = raw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 8);
    }
  }

  const evidence = evidenceMatch
    ? evidenceMatch[1].split("\n")[0].trim()
    : text.trim() || "No answer returned.";

  return { present, prominence, competitors, evidence };
}

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
  stubProvider("openai", "OPENAI_API_KEY", "OpenAI / ChatGPT"),
  stubProvider("gemini", "GEMINI_API_KEY", "Gemini"),
  stubProvider("perplexity", "PERPLEXITY_API_KEY", "Perplexity"),
  stubProvider("google", "SERPAPI_API_KEY", "Google SERP"),
];
