import type { EvidenceSpan } from "./evidence";
import type { PageType } from "./snapshot";

/** Fix categories we support. Deliberately no "FAQPage" tactic anywhere. */
export type FixCategory = "metadata" | "schema" | "crawlability" | "content-structure";
export type FixApplyVia = "github-file" | "github-snippet" | "wordpress-post" | "manual";
export type Confidence = "high" | "medium" | "low";

/** Why a run legitimately produced no fix — a first-class, valuable outcome. */
export type NoFixReason =
  | "already_optimal"
  | "not_applicable"
  | "insufficient_evidence"
  | "low_expected_value"
  | "conflicts_with_page_intent"
  | "requires_site_level_change"
  | "requires_external_information"
  | "unsafe_to_automate";

/**
 * Everything the generator is allowed to see and do for one intervention.
 * Not "here's the page, improve it" — a specific diagnosis, a single allowed
 * category, an explicit edit surface, immutable evidence, and hard prohibitions.
 */
export interface FixContextPackage {
  /** The immutable snapshot this run is bound to. */
  snapshotHash: string;
  url: string;
  host: string;
  pageType: PageType;
  locale: string | null;
  queryCluster?: string;
  query?: string;
  intent?: string;
  siteContext?: string;
  /** The one specific diagnosis this run addresses. */
  diagnosis: string;
  diagnosisConfidence: Confidence;
  /** The report signal key this fix maps to. */
  signalKey: string;
  /** The single allowed fix category. */
  allowedCategory: FixCategory;
  /** Things the model must never do (invented facts, FAQ schema, etc.). */
  forbiddenActions: string[];
  /** The exact edit surface a candidate may target. */
  allowedTargets: string[];
  /** Immutable, numbered evidence — the only support for any factual claim. */
  evidenceSpans: EvidenceSpan[];
  brandConstraints?: string;
  targetOutcome: string;
  /** Existing relevant page content, serialized for the model to work from. */
  relevantContent: string;
}

/** One generated candidate (or a no_fix), before or after validation. */
export interface FixCandidate {
  candidateId: string;
  action: "fix" | "no_fix";
  category: FixCategory | null;
  target: string | null;
  before: string | null;
  after: string | null;
  rationale: string;
  evidenceSpanIds: string[];
  confidence: Confidence;
  applyVia: FixApplyVia | null;
  noFixReason: NoFixReason | null;
}
