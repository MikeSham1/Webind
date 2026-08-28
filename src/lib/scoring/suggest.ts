import Anthropic from "@anthropic-ai/sdk";
import { logInfo, logWarn } from "../log";
import type {
  ActionableSuggestion,
  CrawledPage,
  ReportResult,
  SignalScore,
} from "./types";
import { fixPriority } from "./report";

/**
 * Turn a report's top deficiencies into specific, page-grounded, step-by-step
 * suggestions — the richer successor to the terse `prioritizedFixes` strings.
 *
 * Two paths, same contract as explain.ts:
 *   - With ANTHROPIC_API_KEY, Claude expands each top fix into concrete steps
 *     and a copy-ready example, grounded STRICTLY in the crawl facts we pass it
 *     (it is told never to invent statistics or claims about the business).
 *   - Without a key, or on any failure, a deterministic page-aware fallback is
 *     used — itself an improvement over the generic fix strings, because it
 *     cites the page's real title, word count, heading count, etc.
 *
 * Never throws. Presentation-layer only: suggestions never feed back into the
 * scores.
 */

const MODEL = "claude-opus-4-8";

/** How many top-priority fixes to expand into detailed suggestions. */
const MAX_SUGGESTIONS = 5;

/** The deficient, measured signals worth advising on, best-value first. */
export function rankedDeficiencies(report: ReportResult): SignalScore[] {
  return [...report.ai.signals, ...report.traditional.signals]
    .filter((s): s is SignalScore & { fix: string; score: number } =>
      s.fix !== null && s.score !== null,
    )
    .sort((a, b) => fixPriority(b) - fixPriority(a) || a.key.localeCompare(b.key))
    .slice(0, MAX_SUGGESTIONS);
}

export async function generateSuggestions(
  report: ReportResult,
  page: CrawledPage,
): Promise<ActionableSuggestion[]> {
  const targets = rankedDeficiencies(report);
  if (targets.length === 0) return [];

  const fallback = targets.map((s) => deterministicSuggestion(s, page));

  if (!process.env.ANTHROPIC_API_KEY) return fallback;

  const startedAt = Date.now();
  try {
    const client = new Anthropic();
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 1500,
      system:
        "You are an AI-search (GEO/AEO) optimization expert advising a site " +
        "owner. For each issue, give a specific, actionable recommendation " +
        "grounded ONLY in the page facts provided. Never invent statistics, " +
        "prices, or claims about the business; when a concrete value is needed " +
        "but not provided, use a clearly-marked placeholder like [your figure]. " +
        "Reply with ONLY a JSON array — no prose, no markdown fences.",
      messages: [{ role: "user", content: buildPrompt(report, page, targets) }],
    });

    logInfo("ai_call.ok", {
      provider: "anthropic",
      purpose: "generate_suggestions",
      model: MODEL,
      inputTokens: response.usage?.input_tokens,
      outputTokens: response.usage?.output_tokens,
      durationMs: Date.now() - startedAt,
    });

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");

    const parsed = parseSuggestions(text, targets);
    // Any target Claude dropped or returned malformed keeps its deterministic
    // suggestion, so the user always gets advice for every ranked fix.
    return targets.map(
      (s) =>
        parsed.get(s.key) ?? deterministicSuggestion(s, page),
    );
  } catch (err) {
    logWarn("ai_call.error", {
      provider: "anthropic",
      purpose: "generate_suggestions",
      model: MODEL,
      durationMs: Date.now() - startedAt,
      error: err instanceof Error ? err.message : String(err),
    });
    return fallback;
  }
}

// --- prompt + parsing -------------------------------------------------------

/** Compact, factual snapshot of the page — the only ground truth Claude gets. */
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

  return (
    `PAGE FACTS (the only ground truth — do not contradict or exceed these):\n${facts}\n\n` +
    `ISSUES TO ADDRESS (already ranked by priority):\n${issues}\n\n` +
    `Return a JSON array with one object per issue, in the same order, each:\n` +
    `{"key": "<the issue key>", "title": "<short imperative headline specific to THIS page>", ` +
    `"steps": ["<2-4 concrete steps>"], "rationale": "<one sentence on why it helps AI/search visibility>", ` +
    `"example": "<optional copy-ready snippet: a meta tag, JSON-LD, or a rewritten heading; omit if not applicable>"}`
  );
}

/** Parse Claude's JSON array into validated suggestions, keyed by signal key. */
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
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const key = typeof rec.key === "string" ? rec.key : "";
    if (!allowed.has(key) || out.has(key)) continue;

    const steps = Array.isArray(rec.steps)
      ? rec.steps.filter((x): x is string => typeof x === "string" && x.trim() !== "").slice(0, 4)
      : [];
    const title = typeof rec.title === "string" ? rec.title.trim() : "";
    const rationale = typeof rec.rationale === "string" ? rec.rationale.trim() : "";
    // A suggestion with no title or no steps is useless — skip it so the
    // deterministic fallback fills in for that key instead.
    if (!title || steps.length === 0) continue;

    const example =
      typeof rec.example === "string" && rec.example.trim() !== ""
        ? rec.example.trim()
        : undefined;

    out.set(key, {
      key,
      title,
      steps,
      rationale: rationale || allowed.get(key)!.reason,
      example,
      aiGenerated: true,
    });
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
  answerability: (p) => ({
    step: `You have ${p.headings.length} headings and ${p.listItemCount} list items — make sure each main point is stated as a directly extractable answer in the first line under its heading (a question-style heading is one way, not a requirement).`,
    example: page_qExample(p),
  }),
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

function page_qExample(p: CrawledPage): string | undefined {
  const h = p.headings.find((x) => x.level >= 2 && x.text.length > 3);
  if (!h) return undefined;
  return `Rewrite "${h.text}" as e.g. "What is ${h.text.toLowerCase()}?" and answer it in the first sentence below.`;
}

function attr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}
