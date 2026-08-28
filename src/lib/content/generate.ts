import { assembleDraft } from "./assemble";
import { runSafetyGates } from "./gates";
import { CONTENT_WRITER_SYSTEM, serializeContentInputs } from "./prompt";
import type { ContentDraft, ContentInputs } from "./types";
import type { AiProvider } from "@/lib/ai/types";
import { generate } from "@/lib/ai/generator";
import { geminiProvider } from "@/lib/ai/gemini";
import { vertexGeminiProvider } from "@/lib/ai/vertex-gemini";

/**
 * The app currently uses GEMINI_API_KEY for the base Gemini Developer API path
 * (3.7 planner / fallback). A tuned model produced by Vertex AI is a different
 * backend and auth surface, so it is selected only through the explicit Vertex
 * endpoint variable and uses Google Cloud ADC instead of GEMINI_API_KEY.
 */
export function contentWriterProvider(): AiProvider {
  const vertexEndpoint = process.env.CONTENT_WRITER_VERTEX_ENDPOINT?.trim();
  if (vertexEndpoint) return vertexGeminiProvider(vertexEndpoint);
  return geminiProvider();
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
 * Base mode: Gemini Developer API via GEMINI_API_KEY (currently 3.7 Flash).
 * Tuned mode: Vertex endpoint via CONTENT_WRITER_VERTEX_ENDPOINT + Google Cloud
 * ADC. When no provider is configured or a call fails, generation degrades to
 * the deterministic assembler. Safety gates always run on the selected output.
 */
export async function generateDraft(
  inputs: ContentInputs,
  deps: { provider?: AiProvider } = {},
): Promise<ContentDraft> {
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
        // Base 3.7 may use Google Search grounding. The Vertex tuned provider
        // deliberately ignores this flag and stays bound to the supplied brief.
        grounded: true,
        maxOutputTokens: 4096,
        purpose: "content_write",
      },
      { provider },
    );
    const text = result.text.trim();
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
