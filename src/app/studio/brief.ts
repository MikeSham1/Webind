/**
 * The handoff between the two halves of Content Studio.
 *
 * Planning and drafting used to be strangers: you talked a page through with
 * the AI, then retyped the whole thing into the form underneath. This turns a
 * conversation into the form's starting values.
 *
 * Pure and separate from brief-actions.ts on purpose — that file carries a
 * top-level `use server`, which requires every export to be an async Server
 * Function, and parsing a model's JSON is exactly the part worth unit-testing.
 */

export const PAGE_TYPES = ["landing", "blog", "product", "about", "faq"] as const;
export type PageType = (typeof PAGE_TYPES)[number];

export interface DraftBrief {
  topic: string;
  pageType: PageType;
  tone: string;
  audience: string;
  /** One fact per line — the drafting model may assert nothing else. */
  keyFacts: string;
  brandName: string;
  /** Comma-separated. */
  keywords: string;
}

export const BRIEF_SYSTEM = [
  "You convert a planning conversation into a structured writing brief.",
  "Return ONLY a JSON object with these keys: topic, pageType, tone, audience, keyFacts, brandName, keywords.",
  `pageType must be one of: ${PAGE_TYPES.join(", ")}.`,
  "keyFacts must be an array of short factual statements.",
  "keywords must be an array of short search phrases.",
  "CRITICAL: every entry in keyFacts must be something the USER stated in the conversation.",
  "Never invent facts, statistics, credentials, prices, dates, locations, guarantees, or customer results.",
  "If the user never gave any concrete facts, return an empty keyFacts array rather than inventing any.",
  "Leave a string empty rather than guessing at it.",
].join("\n");

/** Strip a ```json fence if the model wrapped its object in one. */
function unfence(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("```")) return trimmed;
  return trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/, "")
    .trim();
}

/** Coerce a model value that should be a list into clean lines. */
function toLines(value: unknown): string[] {
  const parts = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/\r?\n/)
      : [];
  return parts
    .map((p) => (typeof p === "string" ? p : String(p ?? "")))
    // Models like to bullet their arrays anyway; don't double up the markers.
    .map((p) => p.replace(/^\s*[-*•]\s*/, "").trim())
    .filter(Boolean);
}

function toText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Parse the model's JSON into a brief. Returns null when the response isn't
 * usable at all, so the caller can say so instead of silently opening an empty
 * form that looks like the AI decided the page needed nothing.
 */
export function parseBrief(raw: string): DraftBrief | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(unfence(raw));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;

  const o = parsed as Record<string, unknown>;
  const topic = toText(o.topic);
  // A brief with no topic can't seed the form's one required field, so it is
  // not a usable brief no matter what else came back.
  if (!topic) return null;

  const rawType = toText(o.pageType).toLowerCase();
  const pageType = (PAGE_TYPES as readonly string[]).includes(rawType)
    ? (rawType as PageType)
    : "landing";

  return {
    topic,
    pageType,
    tone: toText(o.tone) || "professional",
    audience: toText(o.audience),
    keyFacts: toLines(o.keyFacts).join("\n"),
    brandName: toText(o.brandName),
    keywords: toLines(o.keywords).join(", "),
  };
}
