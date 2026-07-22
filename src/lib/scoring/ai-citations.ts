import Anthropic from "@anthropic-ai/sdk";

/**
 * Live AI-citation checking.
 *
 * Asks AI answer engines whether a given domain / brand is referenced by
 * authoritative sources (i.e. how likely it is to be *cited* in AI answers).
 * Engines are pluggable behind {@link CitationProvider}. Only the Claude
 * provider is fully implemented; Perplexity and OpenAI are stubs that stay
 * inert until their keys are present and then degrade safely.
 *
 * This module NEVER throws to its caller — every per-engine failure is caught
 * and reported as `cited: null` with a descriptive `evidence` string.
 */

export type Engine = "claude" | "perplexity" | "openai";

export interface EngineCitation {
  engine: Engine;
  /** True when the engine's API key is configured and it was invoked. */
  configured: boolean;
  /** True/false verdict, or null when unknown (not configured, or failed). */
  cited: boolean | null;
  /** Short human-readable evidence or failure description; null when idle. */
  evidence: string | null;
}

export interface CitationResult {
  /** True when at least one engine was configured and ran. */
  configured: boolean;
  engines: EngineCitation[];
  /** 0..100 brand-mention score, or null when nothing was configured. */
  brandMentionScore: number | null;
}

export interface CitationOptions {
  brandName?: string;
}

/** A single engine's verdict, before it is wrapped into an EngineCitation. */
interface ProviderVerdict {
  cited: boolean | null;
  evidence: string | null;
}

/** Pluggable answer-engine interface. Implementations must not read env at
 *  module load — `isConfigured()` is consulted per call so tests can stub. */
interface CitationProvider {
  readonly engine: Engine;
  isConfigured(): boolean;
  check(domain: string, opts: CitationOptions): Promise<ProviderVerdict>;
}

const MODEL = "claude-opus-4-8";

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

// --- Claude provider (fully implemented) ------------------------------------

/**
 * Uses the Anthropic SDK with the server-side web search tool to judge whether
 * `domain` (or its brand) is referenced by authoritative sources such that an
 * AI answer engine would cite it. Model and tool versions follow the
 * `claude-api` skill: model `claude-opus-4-8`, adaptive thinking, and the
 * `web_search_20260209` server tool.
 */
const claudeProvider: CitationProvider = {
  engine: "claude",
  isConfigured: () => Boolean(process.env.ANTHROPIC_API_KEY),
  async check(domain, opts) {
    const client = new Anthropic();
    const subject = opts.brandName
      ? `the brand "${opts.brandName}" (site: ${domain})`
      : `the site "${domain}"`;

    const prompt =
      `Using web search, assess whether ${subject} is referenced by ` +
      `authoritative, independent sources — the kind of coverage that would ` +
      `lead an AI answer engine to cite it when answering questions about ` +
      `its topic. Consider reputable directories, news, industry publications, ` +
      `and encyclopedic sources; ignore the site's own pages and low-quality ` +
      `link farms.\n\n` +
      `When done, end your reply with EXACTLY these two lines:\n` +
      `CITED: yes | no | unknown\n` +
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
      tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 5 }],
      messages,
    });

    for (let i = 0; i < 4 && response.stop_reason === "pause_turn"; i++) {
      messages.push({ role: "assistant", content: response.content });
      response = await client.messages.create({
        model: MODEL,
        max_tokens: 2048,
        thinking: { type: "adaptive" },
        output_config: { effort: "low" },
        tools: [
          { type: "web_search_20260209", name: "web_search", max_uses: 5 },
        ],
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

/** Parse the CITED/EVIDENCE trailer out of a free-form model reply. */
function parseVerdict(text: string): ProviderVerdict {
  const citedMatch = /CITED:\s*(yes|no|unknown)/i.exec(text);
  const evidenceMatch = /EVIDENCE:\s*(.+)/i.exec(text);

  let cited: boolean | null = null;
  if (citedMatch) {
    const v = citedMatch[1].toLowerCase();
    if (v === "yes") cited = true;
    else if (v === "no") cited = false;
  }

  const evidence = evidenceMatch
    ? evidenceMatch[1].trim()
    : text.trim() || "No answer returned.";

  return { cited, evidence };
}

// --- Perplexity provider (stub) ---------------------------------------------
//
// Intentionally NOT implemented against a guessed request/response shape.
// Reports `configured: false` when the key is absent; when the key IS present
// it throws a clearly-marked "not implemented" error that the orchestrator
// catches and degrades to `cited: null`.

const perplexityProvider: CitationProvider = {
  engine: "perplexity",
  isConfigured: () => Boolean(process.env.PERPLEXITY_API_KEY),
  async check() {
    throw new Error("Perplexity citation provider is not yet implemented.");
  },
};

// --- OpenAI provider (stub) -------------------------------------------------

const openaiProvider: CitationProvider = {
  engine: "openai",
  isConfigured: () => Boolean(process.env.OPENAI_API_KEY),
  async check() {
    throw new Error("OpenAI citation provider is not yet implemented.");
  },
};

const PROVIDERS: CitationProvider[] = [
  claudeProvider,
  perplexityProvider,
  openaiProvider,
];

/**
 * Check whether `domain` / brand is cited across the configured AI engines.
 *
 * Degrades gracefully: unconfigured engines are reported inert, and any
 * per-engine network/API failure is caught and surfaced as `cited: null`.
 * Returns `brandMentionScore: null` (and `configured: false`) when no engine
 * is configured at all.
 */
export async function checkAiCitations(
  domain: string,
  opts: CitationOptions = {},
): Promise<CitationResult> {
  const engines: EngineCitation[] = [];

  for (const provider of PROVIDERS) {
    const configured = provider.isConfigured();
    if (!configured) {
      engines.push({
        engine: provider.engine,
        configured: false,
        cited: null,
        evidence: null,
      });
      continue;
    }
    try {
      const verdict = await provider.check(domain, opts);
      engines.push({
        engine: provider.engine,
        configured: true,
        cited: verdict.cited,
        evidence: verdict.evidence,
      });
    } catch (err) {
      engines.push({
        engine: provider.engine,
        configured: true,
        cited: null,
        evidence: `Check failed: ${errorMessage(err)}`,
      });
    }
  }

  const configuredEngines = engines.filter((e) => e.configured);
  const anyConfigured = configuredEngines.length > 0;

  // Proportion of configured engines that cite the brand, scaled to 0..100.
  const brandMentionScore = anyConfigured
    ? Math.round(
        (configuredEngines.filter((e) => e.cited === true).length /
          configuredEngines.length) *
          100,
      )
    : null;

  return { configured: anyConfigured, engines, brandMentionScore };
}
