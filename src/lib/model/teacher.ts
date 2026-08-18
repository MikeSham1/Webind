import { FEATURE_NAMES, type FeatureName } from "./features";

/**
 * The distillation teacher.
 *
 * These labels are Claude's judgment of how citable a page is to AI answer
 * engines, expressed as a function of the page's structural features. They are
 * NOT measured real-world citation outcomes (no such dataset exists — see
 * /methodology). The trained model in this folder learns to imitate this
 * judgment; documenting the teacher in-repo is what keeps that honest and
 * reproducible.
 *
 * The point of distilling rather than shipping the heuristic directly is the
 * non-linear structure below — hard multiplicative gates, saturating returns,
 * and feature interactions — which a linear weighted-sum scorer cannot express.
 * A model trained on these labels can, and a held-out split shows it generalizes
 * rather than memorizing this formula.
 */

const IDX = Object.fromEntries(
  FEATURE_NAMES.map((n, i) => [n, i]),
) as Record<FeatureName, number>;

/** Saturating return: rises fast then plateaus. `half` is the input at 0.5. */
function saturating(x: number, half: number): number {
  if (x <= 0) return 0;
  return x / (x + half);
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

/**
 * Score a feature vector as Claude would judge its AI-citability (0..100).
 * Deterministic; the dataset generator adds the label noise, not this function.
 */
export function teacherLabel(features: number[]): number {
  const f = (name: FeatureName) => features[IDX[name]];

  // --- Content substance: thin pages are weak, depth saturates ~1200 words ---
  const depth = saturating(f("wordCount"), 1200); // 0..1
  const thinPenalty = f("wordCount") < 200 ? 0.45 : 1; // hard drag on stubs

  // --- Extractability: structure AI engines lift into answers ---------------
  const structure =
    0.5 * saturating(f("listItemCount"), 8) +
    0.3 * saturating(f("tableCount"), 2) +
    0.2 * saturating(f("blockquoteCount"), 2);
  const headings = f("headingCount") > 0 ? (f("hasH2") ? 1 : 0.6) : 0.2;
  // Long, unbroken paragraphs hurt extractability.
  const readability = 1 - 0.5 * clamp(f("longParagraphRatio"), 0, 1);

  // --- Machine-readability / identity ---------------------------------------
  const schema =
    (f("hasOrgOrWebsiteSchema") ? 0.7 : 0) +
    0.3 * saturating(f("schemaBlockCount"), 2);
  const meta =
    0.4 * (f("hasCanonical") || 0) +
    0.3 * (f("hasOpenGraph") || 0) +
    0.2 * (f("hasHtmlLang") || 0) +
    0.1 * clamp(f("metaDescLen") / 155, 0, 1);

  // --- Trust / evidence ------------------------------------------------------
  const trust =
    0.4 * (f("hasAboutOrContactLink") || 0) +
    0.3 * (f("hasAuthor") || 0) +
    0.3 * saturating(f("outboundLinkCount"), 3);
  const freshness = f("hasLastModified") ? 1 : 0.4;
  const topicalDepth = saturating(f("internalLinkCount"), 6);
  const altText = clamp(f("altRatio"), 0, 1);

  // Weighted blend of the positive signals (before the gates).
  const base =
    100 *
    (0.24 * depth * thinPenalty +
      0.16 * structure +
      0.08 * headings +
      0.14 * schema +
      0.08 * meta +
      0.12 * trust +
      0.05 * freshness +
      0.07 * topicalDepth +
      0.06 * altText) *
    readability;

  // --- Hard gates (the non-linearity a linear scorer can't express) ---------
  // If AI crawlers are blocked, the page is nearly uncitable no matter how good
  // the content is — a multiplicative gate, not an additive penalty.
  const aiBotGate = f("robotsAllowsAiBots") ? 1 : 0.18;
  // AI crawlers largely don't execute JS; a client-only shell reads as near-empty.
  const renderGate = f("hasServerRenderedContent") ? 1 : 0.45;

  return clamp(base * aiBotGate * renderGate, 0, 100);
}
