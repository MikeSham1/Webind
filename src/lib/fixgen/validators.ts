import { evidenceCorpus } from "./evidence";
import type { FixContextPackage, FixCandidate } from "./types";

/**
 * Deterministic hard validators. These run BEFORE any ranking or UI display; a
 * candidate that fails any of them is rejected outright, never "repaired" into
 * something that changes its meaning. Model judgment is never trusted for
 * anything a deterministic check can decide.
 */
export interface ValidationResult {
  ok: boolean;
  failures: string[];
}

/** High-risk factual tokens (numbers, currency, %, years) that must be grounded. */
function factualTokens(text: string): string[] {
  const matches = text.match(
    /[$£€]\s?\d[\d,.]*|\d[\d,.]*\s?%|\b(?:19|20)\d{2}\b|\b\d{2,}(?:[.,]\d+)?\b/g,
  );
  if (!matches) return [];
  return matches
    // Trim trailing sentence punctuation the number class can over-grab
    // (e.g. "$42." at a sentence end → "$42"), so it matches the same figure
    // in the evidence text.
    .map((t) => t.trim().toLowerCase().replace(/[.,]+$/, ""))
    .filter(Boolean);
}

/** JSON-LD @types that must never be recommended (dead / not-applicable tactics). */
const FORBIDDEN_SCHEMA_TYPES = new Set(["FAQPage", "QAPage"]);

/** Which content @types are applicable to which page type. */
const SCHEMA_APPLICABILITY: Record<string, Set<string>> = {
  product: new Set(["Product", "Organization", "WebSite", "BreadcrumbList"]),
  article: new Set(["Article", "BlogPosting", "NewsArticle", "Organization", "WebSite", "BreadcrumbList"]),
  howto: new Set(["HowTo", "Recipe", "Organization", "WebSite", "BreadcrumbList"]),
  localbusiness: new Set(["LocalBusiness", "Organization", "WebSite", "BreadcrumbList"]),
  organization: new Set(["Organization", "WebSite", "BreadcrumbList"]),
  faq: new Set(["Organization", "WebSite", "BreadcrumbList"]),
  generic: new Set(["Organization", "WebSite", "BreadcrumbList"]),
};

function validateSchema(after: string, ctx: FixContextPackage, failures: string[]): void {
  // Pull @type occurrences (the fix content is JSON-LD, possibly a <script> wrap).
  const types = [...after.matchAll(/"@type"\s*:\s*"([^"]+)"/g)].map((m) => m[1]);
  if (types.length === 0) {
    failures.push("schema fix declares no @type");
    return;
  }
  const allowed = SCHEMA_APPLICABILITY[ctx.pageType] ?? SCHEMA_APPLICABILITY.generic;
  for (const t of types) {
    if (FORBIDDEN_SCHEMA_TYPES.has(t)) failures.push(`forbidden schema type: ${t}`);
    else if (!allowed.has(t)) failures.push(`schema type ${t} not applicable to a ${ctx.pageType} page`);
  }
}

export function validateCandidate(
  c: FixCandidate,
  ctx: FixContextPackage,
): ValidationResult {
  const failures: string[] = [];

  // no_fix is a valid, retained outcome — it just needs a reason code and must
  // never be coerced into a fix.
  if (c.action === "no_fix") {
    if (!c.noFixReason) failures.push("no_fix without a reason code");
    return { ok: failures.length === 0, failures };
  }

  if (c.category !== ctx.allowedCategory) {
    failures.push(`category ${c.category} not allowed (expected ${ctx.allowedCategory})`);
  }
  if (!c.target || !ctx.allowedTargets.includes(c.target)) {
    failures.push(`target "${c.target}" not in the approved edit surface`);
  }
  const after = c.after?.trim() ?? "";
  if (!after) failures.push("empty after");

  // Every cited evidence id must exist in THIS snapshot.
  const validIds = new Set(ctx.evidenceSpans.map((s) => s.spanId));
  const unknownIds = c.evidenceSpanIds.filter((id) => !validIds.has(id));
  if (unknownIds.length) failures.push(`unknown evidence ids: ${unknownIds.join(", ")}`);

  // High-risk factual tokens must be supported by the cited evidence text.
  const tokens = factualTokens(after);
  if (tokens.length > 0) {
    if (c.evidenceSpanIds.length === 0) {
      failures.push("introduces factual tokens but cites no evidence");
    } else {
      const corpus = evidenceCorpus(
        ctx.evidenceSpans,
        c.evidenceSpanIds.filter((id) => validIds.has(id)),
      );
      const unsupported = tokens.filter((t) => !corpus.includes(t));
      if (unsupported.length) {
        failures.push(`unsupported factual tokens: ${unsupported.join(", ")}`);
      }
    }
  }

  // Category-specific applicability.
  if (c.category === "schema" && after) validateSchema(after, ctx, failures);

  return { ok: failures.length === 0, failures };
}

/** Run every candidate through validation, tagging each with its result. */
export function validateAll(
  candidates: FixCandidate[],
  ctx: FixContextPackage,
): { candidate: FixCandidate; result: ValidationResult }[] {
  return candidates.map((candidate) => ({
    candidate,
    result: validateCandidate(candidate, ctx),
  }));
}
