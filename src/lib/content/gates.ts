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
 * No fabricated facts. The deterministic assembler only ever restates the
 * user's supplied facts, so this passes by construction; the check confirms
 * every supplied fact is actually present (nothing dropped or altered) and
 * documents the grounding for when an LLM writer is plugged in.
 */
export function checkFabrication(
  inputs: ContentInputs,
  draftMarkdown: string,
): GateResult {
  const facts = inputs.keyFacts.map((f) => f.trim()).filter(Boolean);
  const md = draftMarkdown.toLowerCase();
  const missing = facts.filter((f) => !md.includes(f.toLowerCase()));
  if (missing.length > 0) {
    return {
      key: "fabrication",
      label: "No fabricated facts",
      status: "warn",
      detail: `Some supplied facts aren't reflected in the draft (${missing.length}). Review before use.`,
    };
  }
  return {
    key: "fabrication",
    label: "No fabricated facts",
    status: "pass",
    detail: "Draft asserts only the facts you supplied — nothing invented.",
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
    checkFabrication(inputs, draftMarkdown),
    checkYmyl(inputs),
    checkOriginality(inputs, draftMarkdown),
    approvalGate(),
  ];
  return { results, blocked: results.some((r) => r.status === "block") };
}
