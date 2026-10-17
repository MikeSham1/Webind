import type {
  ActionableSuggestion,
  CrawledPage,
  ReportResult,
  SignalScore,
} from "./types";
import { cappedSignalKeys, compareFixes } from "./report";
import { classifyPageType } from "./page-type";
import { generate, selectProvider } from "@/lib/ai/generator";

/**
 * Turn a report's top deficiencies into specific, page-grounded, step-by-step
 * suggestions — the richer successor to the terse `prioritizedFixes` strings.
 *
 * Two paths, same contract as explain.ts:
 *   - When a model is configured, Gemini (the model we tune) expands each top
 *     fix into concrete steps and a copy-ready example, in JSON, grounded
 *     STRICTLY in the crawl facts we pass it (never inventing statistics or
 *     claims about the business).
 *   - Without a key, or on any failure, a deterministic page-aware fallback is
 *     used — itself an improvement over the generic fix strings, because it
 *     cites the page's real title, word count, heading count, etc.
 *
 * Never throws. Presentation-layer only: suggestions never feed back into the
 * scores.
 */

const SUGGESTIONS_SYSTEM =
  "You are an AI-search (GEO/AEO) optimization expert advising a site owner. " +
  "For each issue, give a specific, actionable recommendation grounded ONLY in " +
  "the page facts provided. Never invent statistics, prices, or claims about the " +
  "business; when a concrete value is needed but not provided, use a clearly-" +
  "marked placeholder like [your figure]. Respond with JSON only.";

/** How many top-priority fixes to expand into detailed suggestions. */
const MAX_SUGGESTIONS = 5;

/** The deficient, measured signals worth advising on, best-value first. */
export function rankedDeficiencies(report: ReportResult): SignalScore[] {
  return [...report.ai.signals, ...report.traditional.signals]
    .filter((s): s is SignalScore & { fix: string; score: number } =>
      s.fix !== null && s.score !== null,
    )
    .sort(compareFixes(cappedSignalKeys(report)))
    .slice(0, MAX_SUGGESTIONS);
}

export async function generateSuggestions(
  report: ReportResult,
  page: CrawledPage,
): Promise<ActionableSuggestion[]> {
  const targets = rankedDeficiencies(report);
  if (targets.length === 0) return [];

  const fallback = targets.map((s) => deterministicSuggestion(s, page));

  // Gemini (the model we tune) via the provider-neutral layer. json mode +
  // "low" thinking keep it fast; `generate` never throws (fallback:true on an
  // unconfigured or failed call), so the deterministic fallback always covers.
  const provider = selectProvider("gemini");
  if (!provider.isConfigured()) return fallback;

  const result = await generate(
    {
      system: SUGGESTIONS_SYSTEM,
      prompt: buildPrompt(report, page, targets),
      json: true,
      thinkingLevel: "low",
      maxOutputTokens: 1500,
      purpose: "generate_suggestions",
    },
    { provider },
  );
  if (result.fallback || !result.text.trim()) return fallback;

  const parsed = parseModelSuggestions(result.text, targets);
  // Any target the model dropped or returned malformed keeps its deterministic
  // suggestion, so the user always gets advice for every ranked fix.
  return targets.map((s) => parsed.get(s.key) ?? deterministicSuggestion(s, page));
}

/**
 * Parse the model's JSON. Prefers a `{ "suggestions": [...] }` object; falls
 * back to scanning for a bare `[...]` array if the model wrapped it in prose.
 */
function parseModelSuggestions(
  text: string,
  targets: SignalScore[],
): Map<string, ActionableSuggestion> {
  try {
    const structured = structuredToSuggestions(JSON.parse(text), targets);
    if (structured.size > 0) return structured;
  } catch {
    // fall through to the array scanner
  }
  return parseSuggestions(text, targets);
}

// --- prompt + parsing -------------------------------------------------------

/** Compact, factual snapshot of the page — the only ground truth the model gets. */
function buildPrompt(
  report: ReportResult,
  page: CrawledPage,
  targets: SignalScore[],
): string {
  const facts = [
    `URL: ${report.url}`,
    `Title: ${page.title ?? "(none)"}`,
    `Meta description: ${page.metaDescription ?? "(none)"}`,
    `Word count: ${page.wordCount}`,
    `Headings: ${page.headings.map((h) => `H${h.level} "${h.text}"`).slice(0, 15).join(" | ") || "(none)"}`,
    `Named author: ${page.metaAuthor ?? "(none detected)"}`,
    `External sources linked: ${outboundHosts(page).join(", ") || "(none)"}`,
    `Lists: ${page.listCount} (${page.listItemCount} items); tables: ${page.tableCount}; blockquotes: ${page.blockquoteCount}`,
    `Opening text: ${excerpt(page.renderedText, 400)}`,
  ].join("\n");

  const issues = targets
    .map(
      (s) =>
        `- key "${s.key}" (${s.label}, scored ${s.score}/100): ${s.reason} Fix hint: ${s.fix}`,
    )
    .join("\n");

  const allowedKeys = targets.map((s) => `"${s.key}"`).join(", ");
  return (
    `PAGE FACTS (the only ground truth — do not contradict or exceed these):\n${facts}\n\n` +
    `ISSUES TO ADDRESS (already ranked by priority):\n${issues}\n\n` +
    `Return JSON: {"suggestions": [ {"key", "title", "steps", "rationale", "example"} ]} ` +
    `with one entry per issue, in the same order. "key" must be one of: ${allowedKeys}. ` +
    `"title" is a short imperative headline; "steps" is 2-4 concrete strings; ` +
    `"rationale" is one sentence; "example" is an optional copy-ready snippet ` +
    `(meta tag, JSON-LD, rewritten heading). Make every title and example specific ` +
    `to THIS page (reuse its real title, headings, and topic); never invent facts or figures.`
  );
}

/** Validate one raw suggestion record against the allowed keys, or null. */
function coerceSuggestion(
  item: unknown,
  allowed: Map<string, SignalScore>,
  seen: Map<string, ActionableSuggestion>,
): ActionableSuggestion | null {
  if (!item || typeof item !== "object") return null;
  const rec = item as Record<string, unknown>;
  const key = typeof rec.key === "string" ? rec.key : "";
  if (!allowed.has(key) || seen.has(key)) return null;

  const steps = Array.isArray(rec.steps)
    ? rec.steps.filter((x): x is string => typeof x === "string" && x.trim() !== "").slice(0, 4)
    : [];
  const title = typeof rec.title === "string" ? rec.title.trim() : "";
  // A suggestion with no title or no steps is useless — skip it so the
  // deterministic fallback fills in for that key instead.
  if (!title || steps.length === 0) return null;

  const rationale = typeof rec.rationale === "string" ? rec.rationale.trim() : "";
  const example =
    typeof rec.example === "string" && rec.example.trim() !== ""
      ? rec.example.trim()
      : undefined;

  return {
    key,
    title,
    steps,
    rationale: rationale || allowed.get(key)!.reason,
    example,
    aiGenerated: true,
  };
}

/** Turn the forced tool's structured input into validated suggestions. */
export function structuredToSuggestions(
  input: unknown,
  targets: SignalScore[],
): Map<string, ActionableSuggestion> {
  const out = new Map<string, ActionableSuggestion>();
  const allowed = new Map(targets.map((s) => [s.key, s]));
  const list =
    input && typeof input === "object" && Array.isArray((input as { suggestions?: unknown }).suggestions)
      ? (input as { suggestions: unknown[] }).suggestions
      : [];
  for (const item of list) {
    const s = coerceSuggestion(item, allowed, out);
    if (s) out.set(s.key, s);
  }
  return out;
}

/**
 * Legacy text-array parser, kept as a defensive fallback for the rare case the
 * model answers in prose instead of calling the tool. Parses validated
 * suggestions keyed by signal key.
 */
export function parseSuggestions(
  text: string,
  targets: SignalScore[],
): Map<string, ActionableSuggestion> {
  const out = new Map<string, ActionableSuggestion>();
  const allowed = new Map(targets.map((s) => [s.key, s]));

  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start === -1 || end <= start) return out;

  let raw: unknown;
  try {
    raw = JSON.parse(text.slice(start, end + 1));
  } catch {
    return out;
  }
  if (!Array.isArray(raw)) return out;

  for (const item of raw) {
    const s = coerceSuggestion(item, allowed, out);
    if (s) out.set(s.key, s);
  }

  return out;
}

// --- deterministic fallback -------------------------------------------------

/** One sentence on why each signal matters, for the fallback rationale. */
const RATIONALE: Record<string, string> = {
  eeat: "Answer engines cite pages that show clear authorship, evidence, and trust.",
  answerability: "Content structured as extractable answers is far likelier to be quoted.",
  factDensity: "Answer engines cite claims they can attribute to a credible source — support the important ones with primary evidence.",
  schema: "Structured data helps engines understand and confidently cite the page.",
  aiCrawlability: "If AI search crawlers can't read the page, it can't be cited at all.",
  freshness: "A clear, recent update date signals the answer is still current.",
  technicalSeo: "Clean technical basics are table stakes for being indexed and surfaced.",
  onPageOptimization: "On-page hygiene (canonical, viewport, OG, alt text) removes ranking drag.",
  contentQuality: "Pages too thin to fully answer the query rarely get cited.",
  topicalAuthority: "Depth and internal linking signal genuine subject-matter authority.",
};

/**
 * Build a page-grounded suggestion without any AI call. Starts from the
 * signal's own fix hint (already somewhat page-aware), splits it into steps,
 * and adds a concrete, per-key enrichment that references the page's real
 * measured values so the advice is specific rather than generic.
 */
export function deterministicSuggestion(
  s: SignalScore,
  page: CrawledPage,
): ActionableSuggestion {
  const steps = s.fix ? fixToSteps(s.fix) : [];
  const enrich = ENRICHERS[s.key]?.(page);
  if (enrich?.step) steps.push(enrich.step);

  return {
    key: s.key,
    title: titleFor(s),
    steps,
    rationale: RATIONALE[s.key] ?? s.reason,
    example: enrich?.example,
    aiGenerated: false,
  };
}

interface Enrichment {
  step?: string;
  example?: string;
}

/** Per-signal, page-specific enrichment for the deterministic fallback. */
const ENRICHERS: Record<string, (p: CrawledPage) => Enrichment> = {
  technicalSeo: (p) => {
    if (!p.title) {
      return {
        step: "This page has no <title> at all — add a descriptive one under ~60 characters.",
        example: `<title>${host(p)} — [what this page is about]</title>`,
      };
    }
    if (!p.metaDescription) {
      const seed = firstSentence(p.renderedText);
      return {
        step: "You have a <title> but no meta description — add one of ~150 characters.",
        example: `<meta name="description" content="${attr(seed || "[one-sentence summary of this page]")}" />`,
      };
    }
    return {};
  },
  factDensity: () => ({
    step:
      "List the page's key factual claims and attach a credible, primary source to each important one — original data, first-hand results, or a named authority. Support the claims that matter rather than padding in statistics to hit a count.",
  }),
  answerability: (p) => {
    // Answer-first / question-heading advice only makes sense on article-style
    // content. For a homepage/product/category page, keep it to scannability —
    // and never mangle a nav label like "Shop" into "What is Shop?".
    if (classifyPageType(p) === "article") {
      return {
        step:
          "Lead each section with a one-sentence answer to the question a reader would ask, then expand — so an engine can lift that opening line cleanly.",
        example:
          'e.g. under a "Pricing" heading, open with "Plans start at $19/month, billed monthly." before the detail.',
      };
    }
    return {
      step:
        "Make the page scannable: break the key points into short bullet lists and keep paragraphs tight, so an engine can lift a clean passage.",
    };
  },
  freshness: () => ({
    step: "Publish an explicit machine-readable update date so engines can verify recency.",
    example:
      '<script type="application/ld+json">{"@context":"https://schema.org","@type":"Article","dateModified":"2026-01-15"}</script>',
  }),
  eeat: (p) => ({
    step: `The page links to ${outboundHosts(p).length} external source(s) — add a named author byline, and cite the primary, authoritative source behind each important claim (the source that best supports the claim, not a fixed number of links).`,
  }),
  schema: () => ({
    step: "Add Organization and WebSite JSON-LD to the homepage (see the ready-to-apply asset in the report).",
  }),
};

function titleFor(s: SignalScore): string {
  const map: Record<string, string> = {
    eeat: "Strengthen your authorship and evidence",
    answerability: "Restructure the page for AI extraction",
    factDensity: "Back your claims with citable figures",
    schema: "Add structured data engines can trust",
    aiCrawlability: "Let AI search crawlers read the page",
    freshness: "Show a clear, recent update date",
    technicalSeo: "Fix the technical basics",
    onPageOptimization: "Clean up on-page hygiene",
    contentQuality: "Deepen the content to fully answer the query",
    topicalAuthority: "Build topical depth and internal links",
  };
  return map[s.key] ?? s.label;
}

/** Split a "Prefix: a; b; c." fix string into clean imperative steps. */
function fixToSteps(fix: string): string[] {
  const body = fix.replace(/^[^:]+:\s*/, "").replace(/\.$/, "");
  return body
    .split(/;\s*/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1) + ".");
}

// --- small page helpers -----------------------------------------------------

function outboundHosts(page: CrawledPage): string[] {
  const hosts = new Set<string>();
  for (const href of page.outboundLinks) {
    try {
      hosts.add(new URL(href).hostname.replace(/^www\./, ""));
    } catch {
      /* ignore unparseable */
    }
  }
  return [...hosts];
}

function host(page: CrawledPage): string {
  try {
    return new URL(page.url).hostname.replace(/^www\./, "");
  } catch {
    return "your site";
  }
}

function firstSentence(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  const m = /^(.{20,160}?[.!?])\s/.exec(clean);
  return (m ? m[1] : clean.slice(0, 150)).trim();
}

function excerpt(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length <= max ? clean : `${clean.slice(0, max)}…`;
}

function attr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}
