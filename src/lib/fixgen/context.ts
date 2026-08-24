import type { PageSnapshot } from "./snapshot";
import { extractEvidenceSpans } from "./evidence";
import type { FixContextPackage, NoFixReason } from "./types";

/**
 * Deterministic diagnosis + applicability gate. We decide WHETHER a fix is
 * applicable (and the exact edit surface) in code, before the model runs — the
 * model never gets to decide "this product page needs FAQ schema". A gate
 * returns either a context package to generate against, or a `noFix` reason.
 */
export type ContextOrNoFix =
  | { kind: "context"; context: FixContextPackage }
  | { kind: "no_fix"; reason: NoFixReason };

const COMMON_FORBIDDEN = [
  "invent facts, numbers, prices, ratings, reviews, or credentials",
  "add FAQ/FAQPage schema or any inapplicable schema",
  "pad length or make changes just to look SEO-optimized",
];

function base(
  snapshot: PageSnapshot,
  fields: Pick<
    FixContextPackage,
    "diagnosis" | "signalKey" | "allowedCategory" | "allowedTargets" | "targetOutcome" | "relevantContent"
  >,
): FixContextPackage {
  return {
    snapshotHash: snapshot.contentHash,
    url: snapshot.url,
    host: snapshot.host,
    pageType: snapshot.pageType,
    locale: snapshot.locale,
    diagnosisConfidence: "high",
    forbiddenActions: COMMON_FORBIDDEN,
    evidenceSpans: extractEvidenceSpans(snapshot),
    ...fields,
  };
}

/** Meta description fix: applicable only when it's missing or too short/long. */
export function buildMetaDescriptionContext(snapshot: PageSnapshot): ContextOrNoFix {
  const meta = snapshot.metaDescription?.trim() ?? "";
  if (meta.length >= 50 && meta.length <= 165) {
    return { kind: "no_fix", reason: "already_optimal" };
  }
  return {
    kind: "context",
    context: base(snapshot, {
      diagnosis:
        meta.length === 0
          ? "The page has no meta description."
          : "The meta description is too short/long to summarize the page well.",
      signalKey: "onPageOptimization",
      allowedCategory: "metadata",
      allowedTargets: ["<head>"],
      targetOutcome:
        "A single <meta name=\"description\"> (~120-160 chars) that accurately " +
        "summarizes this page using only its own content.",
      relevantContent: [
        `Title: ${snapshot.title ?? "(none)"}`,
        `Existing meta: ${meta || "(none)"}`,
      ].join("\n"),
    }),
  };
}

const SCHEMA_TYPE_FOR_PAGE: Partial<Record<PageSnapshot["pageType"], string>> = {
  product: "Product",
  article: "Article",
  howto: "HowTo",
  localbusiness: "LocalBusiness",
};

/**
 * Content-type schema fix: applicable only when the page has a clear type and
 * no content-type JSON-LD yet. Never suggests FAQ or an inapplicable type.
 */
export function buildSchemaContext(snapshot: PageSnapshot): ContextOrNoFix {
  const wanted = SCHEMA_TYPE_FOR_PAGE[snapshot.pageType];
  if (!wanted) return { kind: "no_fix", reason: "not_applicable" };

  const existing = JSON.stringify(snapshot.jsonLdBlocks);
  if (existing.includes(`"${wanted}"`)) {
    return { kind: "no_fix", reason: "already_optimal" };
  }
  return {
    kind: "context",
    context: base(snapshot, {
      diagnosis: `This ${snapshot.pageType} page has no ${wanted} structured data.`,
      signalKey: "schema",
      allowedCategory: "schema",
      allowedTargets: ["<head>"],
      targetOutcome:
        `A single JSON-LD <script> declaring a ${wanted} whose properties are ` +
        "populated ONLY from cited evidence. Omit any property you have no evidence for.",
      relevantContent: `Detected page type: ${snapshot.pageType}. Desired @type: ${wanted}.`,
    }),
  };
}
