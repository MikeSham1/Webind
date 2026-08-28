import type { SerpResult } from "./types";

/**
 * serper.dev SERP client — the organic top-30 for a query.
 *
 * Optional like every other provider: with no SERPER_API_KEY the benchmark
 * degrades to "not configured" rather than failing. Nothing is read at module
 * load, and `fetch` is injectable so tests never touch the network.
 */

const ENDPOINT = "https://google.serper.dev/search";

export function isSerperConfigured(): boolean {
  return Boolean(process.env.SERPER_API_KEY);
}

export type SerperResult =
  | { ok: true; results: SerpResult[] }
  | { ok: false; error: string };

export interface SerperOptions {
  /** Results to request (serper returns ~10/page; ask for up to 30). */
  num?: number;
  /** Country (gl) and language (hl) to localize the SERP. */
  gl?: string;
  hl?: string;
  /** Injectable for tests. Defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

/**
 * Fetch organic results for a query. Never throws: a missing key, network
 * error, or bad response all return `{ ok: false }` with a visitor-safe message.
 */
export async function serperSearch(
  query: string,
  opts: SerperOptions = {},
): Promise<SerperResult> {
  const key = process.env.SERPER_API_KEY;
  if (!key) return { ok: false, error: "SERP lookups aren't configured." };

  const q = query.trim();
  if (!q) return { ok: false, error: "Empty query." };

  const fetchImpl = opts.fetchImpl ?? fetch;
  try {
    const res = await fetchImpl(ENDPOINT, {
      method: "POST",
      headers: { "X-API-KEY": key, "Content-Type": "application/json" },
      body: JSON.stringify({
        q,
        num: Math.min(30, Math.max(10, opts.num ?? 30)),
        gl: opts.gl ?? "us",
        hl: opts.hl ?? "en",
      }),
    });
    if (!res.ok) {
      return { ok: false, error: `SERP lookup failed (${res.status}).` };
    }
    const data = (await res.json()) as { organic?: unknown };
    return { ok: true, results: parseOrganic(data.organic) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "SERP lookup failed." };
  }
}

/** Defensively pull well-formed organic rows out of an untrusted response. */
function parseOrganic(organic: unknown): SerpResult[] {
  if (!Array.isArray(organic)) return [];
  const out: SerpResult[] = [];
  for (const row of organic) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const link = typeof r.link === "string" ? r.link : null;
    const position = typeof r.position === "number" ? r.position : out.length + 1;
    if (!link) continue;
    out.push({
      position,
      link,
      title: typeof r.title === "string" ? r.title : "",
      snippet: typeof r.snippet === "string" ? r.snippet : undefined,
    });
  }
  return out;
}
