export type EvidenceStrength = "official" | "systematic-review" | "experimental";

export interface ResearchPrinciple {
  id: string;
  appliesTo: "writing" | "training";
  directive: string;
  evidenceStrength: EvidenceStrength;
  scope: string;
  sourceTitle: string;
  sourceUrl: string;
  checkedAt: string;
}

/**
 * Versioned evidence registry for the content-writer tune.
 *
 * These are not secret ranking factors. They are public, auditable claims from
 * primary guidance and research that define the behavior we want to teach and
 * the limits we explicitly do NOT claim. Keep this list small enough to review
 * whenever the corpus is regenerated.
 */
export const CONTENT_RESEARCH_VERSION = "2026-08-28-v1";

export const CONTENT_RESEARCH_PRINCIPLES: readonly ResearchPrinciple[] = [
  {
    id: "people-first-non-commodity",
    appliesTo: "writing",
    directive:
      "Prefer useful, reliable, differentiated information that satisfies the visitor over generic commodity copy written mainly to manipulate visibility.",
    evidenceStrength: "official",
    scope: "Google Search and its generative AI features",
    sourceTitle: "Google's Guide to Optimizing for Generative AI Features on Google Search",
    sourceUrl: "https://developers.google.com/search/docs/fundamentals/ai-optimization-guide",
    checkedAt: "2026-08-28",
  },
  {
    id: "clear-reader-organization",
    appliesTo: "writing",
    directive:
      "Organize material for readers with coherent paragraphs, descriptive sections, and headings; structure is a readability aid, not an AI-only hack.",
    evidenceStrength: "official",
    scope: "Google Search and its generative AI features",
    sourceTitle: "Google's Guide to Optimizing for Generative AI Features on Google Search",
    sourceUrl: "https://developers.google.com/search/docs/fundamentals/ai-optimization-guide",
    checkedAt: "2026-08-28",
  },
  {
    id: "no-ai-format-folklore",
    appliesTo: "writing",
    directive:
      "Do not force tiny chunks, a fixed page length, exhaustive long-tail variants, special AI prose, or llms.txt assumptions into copy; choose length and structure for the task and audience.",
    evidenceStrength: "official",
    scope: "Google Search; llms.txt conclusion is Google-specific",
    sourceTitle: "Google's Guide to Optimizing for Generative AI Features on Google Search",
    sourceUrl: "https://developers.google.com/search/docs/fundamentals/ai-optimization-guide",
    checkedAt: "2026-08-28",
  },
  {
    id: "relevance-before-formatting",
    appliesTo: "writing",
    directive:
      "Keep the main query and its genuinely necessary subtopics central. Do not trade topical relevance for formatting tricks or citation-oriented rewrites.",
    evidenceStrength: "systematic-review",
    scope: "45 GEO studies reviewed across 2023-2026; effects are platform- and stage-dependent",
    sourceTitle: "Optimizing Visibility in Generative Engines: A Critical Survey of Generative Engine Optimization (2023-2026)",
    sourceUrl: "https://arxiv.org/abs/2607.14035",
    checkedAt: "2026-08-28",
  },
  {
    id: "evidence-without-citation-spam",
    appliesTo: "writing",
    directive:
      "Attach evidence to consequential claims when evidence is supplied or requested, but never manufacture citations or add references only to increase citation count.",
    evidenceStrength: "systematic-review",
    scope: "Generative-engine citation/retrieval literature; not a universal ranking rule",
    sourceTitle: "Optimizing Visibility in Generative Engines: A Critical Survey of Generative Engine Optimization (2023-2026)",
    sourceUrl: "https://arxiv.org/abs/2607.14035",
    checkedAt: "2026-08-28",
  },
  {
    id: "synthetic-bootstrap-with-filtering",
    appliesTo: "training",
    directive:
      "Synthetic instruction data is acceptable only with diversity controls, filtering, and a held-out evaluation; generated examples are candidate labels, not ground truth merely because a teacher produced them.",
    evidenceStrength: "experimental",
    scope: "Instruction tuning methodology",
    sourceTitle: "Self-Instruct: Aligning Language Models with Self-Generated Instructions",
    sourceUrl: "https://arxiv.org/abs/2212.10560",
    checkedAt: "2026-08-28",
  },
  {
    id: "no-universal-geo-formula",
    appliesTo: "training",
    directive:
      "Treat Webind metrics as auditable proxies and evaluate by slice. Do not encode any score as a claim of a universal search or answer-engine ranking formula.",
    evidenceStrength: "systematic-review",
    scope: "GEO evidence through July 2026",
    sourceTitle: "Optimizing Visibility in Generative Engines: A Critical Survey of Generative Engine Optimization (2023-2026)",
    sourceUrl: "https://arxiv.org/abs/2607.14035",
    checkedAt: "2026-08-28",
  },
] as const;

export function researchWritingRules(): string[] {
  return CONTENT_RESEARCH_PRINCIPLES.filter((p) => p.appliesTo === "writing").map(
    (p) => `- ${p.directive}`,
  );
}
