import { normalizeUrl } from "@/lib/crawler/ssrf";
import { logWarn } from "@/lib/log";
import type {
  AnswerEngine,
  EngineVisibility,
  VisibilityQuery,
  VisibilityReport,
} from "./types";
import { buildVisibilityReport, summarizeKeyword } from "./score";
import {
  PROVIDERS,
  type ProbeContext,
  type VisibilityProvider,
} from "./providers";

/** Upper bound on keywords per run, so one request can't fan out unboundedly. */
export const MAX_KEYWORDS = 10;

export interface CheckOptions {
  /** Injectable provider list (tests pass stubs so they never hit the network). */
  providers?: VisibilityProvider[];
}

/** Extract a clean hostname for display and probing from loose input. */
function toDomain(raw: string): string | null {
  const url = normalizeUrl(raw);
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

/** Deduplicate and cap keywords while preserving the caller's priority order. */
function cleanKeywords(keywords: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of keywords) {
    const k = raw.trim();
    if (!k) continue;
    const key = k.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(k);
    if (out.length >= MAX_KEYWORDS) break;
  }
  return out;
}

/** Result of {@link checkKeywordVisibility}. */
export type CheckResult =
  | { ok: true; report: VisibilityReport }
  | { ok: false; error: string };

/**
 * Probe each keyword against each provider and assemble a visibility report.
 *
 * Never throws: bad input returns a friendly error, and any per-probe failure
 * degrades to an unknown verdict rather than aborting the run — the same
 * fail-soft contract as the citation checker. When no engine is configured, the
 * report still returns (every score null) so the UI can prompt for a key.
 *
 * Probes run concurrently per keyword; keywords run sequentially to keep the
 * pressure on the answer-engine APIs bounded.
 */
export async function checkKeywordVisibility(
  input: VisibilityQuery,
  opts: CheckOptions = {},
): Promise<CheckResult> {
  const domain = toDomain(input.domain);
  if (!domain) {
    return {
      ok: false,
      error: "That doesn't look like a valid website address.",
    };
  }

  const keywords = cleanKeywords(input.keywords);
  if (keywords.length === 0) {
    return { ok: false, error: "Add at least one keyword or question to check." };
  }

  const providers = opts.providers ?? PROVIDERS;
  const ctx: ProbeContext = {
    domain,
    brandName: input.brandName?.trim() || domain,
  };

  const query: VisibilityQuery = { ...input, domain, keywords };

  const keywordResults = [];
  for (const keyword of keywords) {
    const engines = await Promise.all(
      providers.map((p) => probeOne(p, keyword, ctx)),
    );
    keywordResults.push(summarizeKeyword(keyword, engines));
  }

  return { ok: true, report: buildVisibilityReport(query, keywordResults) };
}

/** Run a single provider for a single keyword, catching every failure mode. */
async function probeOne(
  provider: VisibilityProvider,
  keyword: string,
  ctx: ProbeContext,
): Promise<EngineVisibility> {
  const engine: AnswerEngine = provider.engine;

  if (!provider.isConfigured()) {
    return {
      engine,
      configured: false,
      present: null,
      prominence: null,
      competitors: [],
      evidence: null,
    };
  }

  try {
    const verdict = await provider.probe(keyword, ctx);
    return {
      engine,
      configured: true,
      present: verdict.present,
      prominence: verdict.prominence,
      competitors: verdict.competitors,
      evidence: verdict.evidence,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logWarn("ai_call.error", { provider: engine, purpose: "visibility_probe", error: message });
    return {
      engine,
      configured: true,
      present: null,
      prominence: null,
      competitors: [],
      evidence: `Check failed: ${message}`,
    };
  }
}
