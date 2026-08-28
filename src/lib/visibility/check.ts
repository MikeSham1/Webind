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

/** Hard cap on probes per engine×keyword, so a misconfig can't fan out cost. */
export const MAX_SAMPLES = 5;

export interface CheckOptions {
  /** Injectable provider list (tests pass stubs so they never hit the network). */
  providers?: VisibilityProvider[];
  /**
   * Probes per engine×keyword. AI answers are stochastic, so repeated probes
   * give a real citation rate with a credible interval instead of a coin-flip
   * yes/no. Defaults to VISIBILITY_SAMPLES (or 1 — single-probe, unchanged cost
   * and behaviour). Capped at {@link MAX_SAMPLES}.
   */
  samples?: number;
}

/** Resolve the sample count from options → env → default, clamped to [1, MAX]. */
function resolveSamples(opt?: number): number {
  const fromEnv = Number(process.env.VISIBILITY_SAMPLES);
  const raw = opt ?? (Number.isFinite(fromEnv) ? fromEnv : 1);
  return Math.max(1, Math.min(MAX_SAMPLES, Math.floor(raw) || 1));
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
  const samples = resolveSamples(opts.samples);
  const ctx: ProbeContext = {
    domain,
    brandName: input.brandName?.trim() || domain,
  };

  const query: VisibilityQuery = { ...input, domain, keywords };

  const keywordResults = [];
  for (const keyword of keywords) {
    const engines = await Promise.all(
      providers.map((p) => probeEngine(p, keyword, ctx, samples)),
    );
    keywordResults.push(summarizeKeyword(keyword, engines));
  }

  return { ok: true, report: buildVisibilityReport(query, keywordResults) };
}

/**
 * Probe one engine `samples` times for a keyword and pool the verdicts. A
 * single sample behaves exactly as before. With more, `present` becomes the
 * majority of definite probes and `hits`/`samples` carry the raw counts so the
 * report can put a credible interval on the rate. Probes run sequentially per
 * engine to keep concurrency at one call per engine, as before.
 */
async function probeEngine(
  provider: VisibilityProvider,
  keyword: string,
  ctx: ProbeContext,
  samples: number,
): Promise<EngineVisibility> {
  const runs: EngineVisibility[] = [];
  for (let i = 0; i < samples; i++) {
    runs.push(await probeOne(provider, keyword, ctx));
  }

  const definite = runs.filter((r) => r.present !== null);
  const engine = provider.engine;

  // No definite verdict from any probe: pass through the first result (carries
  // the not-configured / failure evidence) unchanged.
  if (definite.length === 0) return runs[0];

  const hits = definite.filter((r) => r.present === true);
  const prominences = hits
    .map((r) => r.prominence)
    .filter((p): p is number => p !== null);
  const avgProminence =
    prominences.length > 0
      ? Math.round(prominences.reduce((s, p) => s + p, 0) / prominences.length)
      : null;

  // Union of competitors seen across probes, first-seen order preserved.
  const competitors = [...new Set(definite.flatMap((r) => r.competitors))];

  const present = hits.length * 2 >= definite.length; // majority (ties → present)
  const base = hits[0] ?? definite[0];
  const evidence =
    samples > 1
      ? `${base.evidence ?? "Checked"} (present in ${hits.length}/${definite.length} probes)`
      : base.evidence;

  return {
    engine,
    configured: true,
    present,
    prominence: present ? avgProminence : null,
    competitors,
    evidence,
    samples: definite.length,
    hits: hits.length,
  };
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
