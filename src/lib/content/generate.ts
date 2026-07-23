import { assembleDraft } from "./assemble";
import { runSafetyGates } from "./gates";
import type { ContentDraft, ContentInputs } from "./types";

const YMYL_DISCLAIMER =
  "\n\n---\n\n*Disclaimer: This content is for general information only and is not professional advice. Consult a qualified professional for your specific situation.*";

/**
 * Produce a reviewed draft: assemble the content (deterministic for now — the
 * plug-in point for an LLM writer), run the safety gates, and append a
 * disclaimer when a YMYL topic is flagged. Pure and never throws.
 */
export function generateDraft(inputs: ContentInputs): ContentDraft {
  const { title, markdown } = assembleDraft(inputs);
  const gates = runSafetyGates(inputs, markdown);

  const ymylFlagged = gates.results.some(
    (g) => g.key === "ymyl" && g.status !== "pass",
  );
  const finalMarkdown = ymylFlagged ? markdown + YMYL_DISCLAIMER : markdown;

  return { title, markdown: finalMarkdown, gates };
}
