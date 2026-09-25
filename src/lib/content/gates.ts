import type { ContentInputs, GateReport, GateResult } from "./types";

const YMYL_TERMS: { category: string; terms: string[] }[] = [
  {
    category: "health/medical",
    terms: [
      "symptom", "diagnos", "treatment", "medication", "dosage", "disease",
      "cancer", "therapy", "prescription", "cure", "supplement", "mental health",
    ],
  },
  {
    category: "financial",
    terms: [
      "invest", "returns", "stock", "crypto", "loan", "mortgage", "tax",
      "retirement", "insurance", "refinanc", "interest rate",
    ],
  },
  {
    category: "legal",
    terms: [
      "lawsuit", "legal advice", "attorney", "liability", "contract law",
      "rights", "sue", "settlement", "compliance",
    ],
  },
];

/** Lowercased word 3-grams for a coarse similarity measure. */
function trigrams(text: string): Set<string> {
  const words = text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean);
  const grams = new Set<string>();
  for (let i = 0; i + 2 < words.length; i++) {
    grams.add(`${words[i]} ${words[i + 1]} ${words[i + 2]}`);
  }
  return grams;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const g of a) if (b.has(g)) inter++;
  return inter / (a.size + b.size - inter);
}

/**
 * Supplied-facts coverage — NOT a fabrication/invented-claims detector. This
 * only confirms every fact the user supplied is actually present in the
 * draft (nothing dropped or altered); it has no way to notice a claim the
 * draft ADDED that the user never supplied, which is what "no fabrication"
 * would actually require. Mislabeling this as a fabrication check let a
 * draft with invented claims layered on top of the real facts still show a
 * "pass" — a plugged-in LLM writer (rather than the deterministic
 * assembler, which only ever restates supplied facts) is exactly the case
 * where that gap matters. Human review of the actual draft text remains the
 * real safeguard against invented claims; this check does not provide it.
 */
export function checkFactsCoverage(
  inputs: ContentInputs,
  draftMarkdown: string,
): GateResult {
  const facts = inputs.keyFacts.map((f) => f.trim()).filter(Boolean);
  const md = draftMarkdown.toLowerCase();
  const missing = facts.filter((f) => !md.includes(f.toLowerCase()));
  if (missing.length > 0) {
    return {
      key: "facts_coverage",
      label: "Supplied-facts coverage",
      status: "warn",
      detail: `Some supplied facts aren't reflected in the draft (${missing.length}). Review before use.`,
    };
  }
  return {
    key: "facts_coverage",
    label: "Supplied-facts coverage",
    status: "pass",
    detail:
      "Every fact you supplied appears in the draft. This does not check for claims the draft may have added beyond what you supplied — read it before approving.",
  };
}

/** Detect Your-Money-or-Your-Life topics that need sign-off + a disclaimer. */
export function checkYmyl(inputs: ContentInputs): GateResult {
  const haystack = [
    inputs.topic,
    ...(inputs.keyFacts ?? []),
    ...(inputs.keywords ?? []),
  ]
    .join(" ")
    .toLowerCase();

  const hits = YMYL_TERMS.filter((group) =>
    group.terms.some((t) => haystack.includes(t)),
  ).map((g) => g.category);

  if (hits.length > 0) {
    return {
      key: "ymyl",
      label: "Sensitive-topic (YMYL) check",
      status: "warn",
      detail: `Detected ${hits.join(", ")} topic(s). A disclaimer is added and explicit human sign-off is required — do not present as professional advice.`,
    };
  }
  return {
    key: "ymyl",
    label: "Sensitive-topic (YMYL) check",
    status: "pass",
    detail: "No medical, financial, or legal advice topics detected.",
  };
}

/** Flag near-duplication of the site's existing content (when provided). */
export function checkOriginality(
  inputs: ContentInputs,
  draftMarkdown: string,
): GateResult {
  const existing = inputs.existingContent?.trim();
  if (!existing) {
    return {
      key: "originality",
      label: "Originality",
      status: "info",
      detail: "No existing content provided to compare against — add it to enable this check.",
    };
  }
  const similarity = jaccard(trigrams(draftMarkdown), trigrams(existing));
  if (similarity >= 0.5) {
    return {
      key: "originality",
      label: "Originality",
      status: "block",
      detail: `Draft is ${Math.round(similarity * 100)}% similar to the existing content — rework before use (duplicate content hurts rankings).`,
    };
  }
  if (similarity >= 0.25) {
    return {
      key: "originality",
      label: "Originality",
      status: "warn",
      detail: `Draft shares ${Math.round(similarity * 100)}% overlap with existing content — consider differentiating.`,
    };
  }
  return {
    key: "originality",
    label: "Originality",
    status: "pass",
    detail: "Draft is sufficiently distinct from your existing content.",
  };
}

/** Human approval is always mandatory — nothing is final without it. */
export function approvalGate(): GateResult {
  return {
    key: "approval",
    label: "Human approval",
    status: "info",
    detail: "Required — no content is finalized or used until you explicitly approve it.",
  };
}

export function runSafetyGates(
  inputs: ContentInputs,
  draftMarkdown: string,
): GateReport {
  const results: GateResult[] = [
    checkFactsCoverage(inputs, draftMarkdown),
    checkYmyl(inputs),
    checkOriginality(inputs, draftMarkdown),
    approvalGate(),
  ];
  return { results, blocked: results.some((r) => r.status === "block") };
}
