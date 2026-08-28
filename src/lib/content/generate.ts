import { assembleDraft } from "./assemble";
import { runSafetyGates } from "./gates";
import { CONTENT_WRITER_SYSTEM, serializeContentInputs } from "./prompt";
import type { ContentDraft, ContentInputs } from "./types";
import type { AiProvider } from "@/lib/ai/types";
import { generate } from "@/lib/ai/generator";
import { geminiProvider } from "@/lib/ai/gemini";

/**
 * The content writer's model: a fine-tuned endpoint when CONTENT_WRITER_MODEL is
 * set, otherwise base Gemini. Wired now so flipping to the tuned model is one
 * env var, no code change.
 */
function contentWriterProvider(): AiProvider {
  return geminiProvider(process.env.CONTENT_WRITER_MODEL || undefined);
}

const YMYL_DISCLAIMER =
  "\n\n---\n\n*Disclaimer: This content is for general information only and is not professional advice. Consult a qualified professional for your specific situation.*";

/** Pull the H1 title out of the model's markdown, or null. */
function titleFromMarkdown(markdown: string): string | null {
  const m = markdown.match(/^\s*#\s+(.+?)\s*$/m);
  return m ? m[1].trim() : null;
}

/**
 * Produce a reviewed draft.
 *
 * The writer is an LLM (Gemini by default) prompted with the content-writer
 * contract; when no key is configured or the call fails, it degrades to the
 * deterministic template assembler so the Studio always returns something. The
 * safety gates ALWAYS run on the chosen content — model or template — so nothing
 * skips the fabrication / YMYL / originality checks or the human approval step.
 * Never throws.
 */
export async function generateDraft(
  inputs: ContentInputs,
  deps: { provider?: AiProvider } = {},
): Promise<ContentDraft> {
  // Deterministic assembly is the always-available fallback.
  const fallback = assembleDraft(inputs);
  let title = fallback.title;
  let markdown = fallback.markdown;
  let writtenBy: ContentDraft["writtenBy"] = "template";

  const provider = deps.provider ?? contentWriterProvider();
  if (provider.isConfigured()) {
    const result = await generate(
      {
        system: CONTENT_WRITER_SYSTEM,
        prompt: serializeContentInputs(inputs),
        json: false,
        // Let the writer consult live search for current, accurate context —
        // still bound by "assert only supplied facts; placeholders otherwise".
        grounded: true,
        maxOutputTokens: 4096,
        purpose: "content_write",
      },
      { provider },
    );
    const text = result.text.trim();
    // `generate` never throws — it returns fallback:true on an unconfigured or
    // failed call, in which case we keep the template output.
    if (!result.fallback && text) {
      markdown = text;
      title = titleFromMarkdown(text) ?? fallback.title;
      writtenBy = "model";
    }
  }

  const gates = runSafetyGates(inputs, markdown);
  const ymylFlagged = gates.results.some((g) => g.key === "ymyl" && g.status !== "pass");
  const finalMarkdown = ymylFlagged ? markdown + YMYL_DISCLAIMER : markdown;

  return { title, markdown: finalMarkdown, gates, writtenBy };
}
