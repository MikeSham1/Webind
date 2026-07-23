import type { ContentInputs } from "./types";

/**
 * Deterministically assemble a page draft from the user's Q&A inputs.
 *
 * This is intentionally a grounded, template-based composer: it only ever uses
 * facts the user supplied, so nothing is fabricated. It is the plug-in point
 * for an LLM writer later — swap this for a Claude call that is given the same
 * inputs and constrained to the same facts, then run the identical safety gates.
 */
export function assembleDraft(inputs: ContentInputs): {
  title: string;
  markdown: string;
} {
  const title = inputs.topic.trim();
  const brand = inputs.brandName?.trim();
  const audience = inputs.audience.trim();
  const facts = inputs.keyFacts.map((f) => f.trim()).filter(Boolean);

  const lines: string[] = [`# ${title}`, ""];

  // Intro — composed only from provided fields.
  const introLead = brand ? `${brand} presents ${title.toLowerCase()}` : title;
  const introTail = audience ? ` for ${audience}` : "";
  lines.push(`${introLead}${introTail}.`, "");

  if (facts.length) {
    lines.push("## Key details", "");
    for (const fact of facts) lines.push(`- ${fact}`);
    lines.push("");
  }

  const keywords = (inputs.keywords ?? []).map((k) => k.trim()).filter(Boolean);
  if (keywords.length) {
    lines.push("## Topics covered", "", keywords.join(" · "), "");
  }

  lines.push(
    "## Next steps",
    "",
    brand
      ? `Learn more about how ${brand} can help.`
      : "Learn more and get in touch.",
  );

  return { title, markdown: lines.join("\n").trim() };
}
