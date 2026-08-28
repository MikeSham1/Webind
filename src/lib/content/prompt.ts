import type { ContentInputs, PageType } from "./types";

/** Human-readable labels for the content writer's page types. */
const PAGE_TYPE_LABEL: Record<PageType, string> = {
  landing: "Landing page",
  blog: "Blog / article",
  product: "Product page",
  about: "About page",
  faq: "FAQ page",
};

/**
 * The content-writer contract: the system instruction and the serialized user
 * turn. This is the single source of truth for how a writing model is asked to
 * work — used to build fine-tuning rows now, and to be the prompt when a tuned
 * Gemini replaces the deterministic assembler as the actual writer.
 *
 * The system prompt encodes established SEO / AI-search (GEO/AEO) best practice
 * — the same principles WeBind's scorer already grades — as instructions, not
 * as fabricated research. It is deliberately strict about never inventing facts:
 * the model may assert ONLY the key facts it is given, using a clearly-marked
 * placeholder otherwise.
 */
export const CONTENT_WRITER_SYSTEM = [
  "You are WeBind Design's content writer. You write clear, genuinely useful web copy that both people and AI answer engines can use.",
  "",
  "Ground rules — non-negotiable:",
  "- Assert ONLY the key facts you are given. Never invent statistics, prices, dates, names, or claims about the business. When a specific value is needed but not provided, use a clearly-marked placeholder like [your figure] or [cite source].",
  "- Attribute claims to a source where one is warranted; don't manufacture citations.",
  "- Write for the stated audience and tone. Plain language, active voice, no filler.",
  "",
  "Structure for extraction:",
  "- Lead each section with the answer, then expand, so an engine can lift the opening line cleanly.",
  "- Use short paragraphs, and bullet lists or a table where they genuinely fit — not as decoration.",
  "- Match the page type: an article can use question-style headings and cite evidence; a homepage or product page should be scannable and positioning-led, not forced into a Q&A shape.",
  "",
  "Do NOT do the things that only look optimized: no keyword stuffing, no padding to hit a length, no manufactured FAQ sections, no repeating the target phrase unnaturally. Depth, clarity, and original usefulness win.",
  "",
  "Output GitHub-flavored Markdown starting with a single H1 title. No preamble, no explanation of what you did.",
].join("\n");

/** Serialize the writing brief into the user turn — the model's ground truth. */
export function serializeContentInputs(inputs: ContentInputs): string {
  const lines = [
    `Topic / title: ${inputs.topic}`,
    `Page type: ${PAGE_TYPE_LABEL[inputs.pageType]}`,
    `Audience: ${inputs.audience}`,
    `Tone: ${inputs.tone}`,
  ];
  if (inputs.brandName) lines.push(`Brand: ${inputs.brandName}`);
  if (inputs.keywords?.length) lines.push(`Target terms (use naturally, do not stuff): ${inputs.keywords.join(", ")}`);
  if (inputs.targetUrl) lines.push(`Target URL: ${inputs.targetUrl}`);
  lines.push(
    "",
    "Key facts — you may assert ONLY these; use a placeholder for anything else:",
    ...(inputs.keyFacts.length ? inputs.keyFacts.map((f) => `- ${f}`) : ["- (none provided — keep claims general and use placeholders)"]),
  );
  if (inputs.existingContent) {
    lines.push("", "Existing content to improve on (add information it lacks; don't just paraphrase):", inputs.existingContent);
  }
  return lines.join("\n");
}

/** The Gemini/Vertex supervised-tuning row shape (one turn pair). */
export interface TuningRow {
  systemInstruction: { parts: { text: string }[] };
  contents: { role: "user" | "model"; parts: { text: string }[] }[];
}

/** Build a tuning row from a brief and its ideal output. */
export function toTuningRow(inputs: ContentInputs, output: string): TuningRow {
  return {
    systemInstruction: { parts: [{ text: CONTENT_WRITER_SYSTEM }] },
    contents: [
      { role: "user", parts: [{ text: serializeContentInputs(inputs) }] },
      { role: "model", parts: [{ text: output }] },
    ],
  };
}
