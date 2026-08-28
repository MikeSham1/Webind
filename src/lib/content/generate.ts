import { assembleDraft } from "./assemble";
import { runSafetyGates } from "./gates";
import { CONTENT_WRITER_SYSTEM, serializeContentInputs } from "./prompt";
import type { ContentDraft, ContentInputs } from "./types";
import type { AiProvider } from "@/lib/ai/types";
import { generate } from "@/lib/ai/generator";
import { gemini37Provider } from "@/lib/ai/gemini";
import { vertexGeminiProvider } from "@/lib/ai/vertex-gemini";

/**
 * The primary content writer. Existing deployments remain on the pinned base
 * Gemini 3.7 Developer API path unless a Vertex tuned endpoint is explicitly
 * configured.
 */
export function contentWriterProvider(): AiProvider {
  const vertexEndpoint = process.env.CONTENT_WRITER_VERTEX_ENDPOINT?.trim();
  if (vertexEndpoint) return vertexGeminiProvider(vertexEndpoint);
  return gemini37Provider();
}

export function contentWriterProviders(): AiProvider[] {
  const primary = contentWriterProvider();
  // A tuned Vertex endpoint is an optional enhancement, never a new single
  // point of failure. If its auth, endpoint, quota, or network call fails, the
  // existing GEMINI_API_KEY-backed 3.7 writer gets the same request next.
  return process.env.CONTENT_WRITER_VERTEX_ENDPOINT?.trim()
    ? [primary, gemini37Provider()]
    : [primary];
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
 * Runtime order when no test/provider override is injected:
 *   tuned Vertex writer -> base Gemini 3.7 -> deterministic template.
 *
 * Every final-drafting model receives the same explicit factual universe: the
 * supplied brief. Search-grounded Gemini remains available for visibility
 * measurement, but is not attached to content generation where external facts
 * would conflict with the writer contract and SFT examples.
 */
export async function generateDraft(
  inputs: ContentInputs,
  deps: { provider?: AiProvider; providers?: AiProvider[] } = {},
): Promise<ContentDraft> {
  const fallback = assembleDraft(inputs);
  let title = fallback.title;
  let markdown = fallback.markdown;
  let writtenBy: ContentDraft["writtenBy"] = "template";

  const providers = deps.provider
    ? [deps.provider]
    : deps.providers ?? contentWriterProviders();
  for (const provider of providers) {
    if (!provider.isConfigured()) continue;
    const result = await generate(
      {
        system: CONTENT_WRITER_SYSTEM,
        prompt: serializeContentInputs(inputs),
        json: false,
        grounded: false,
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
      break;
    }
  }

  const gates = runSafetyGates(inputs, markdown);
  const ymylFlagged = gates.results.some((g) => g.key === "ymyl" && g.status !== "pass");
  const finalMarkdown = ymylFlagged ? markdown + YMYL_DISCLAIMER : markdown;

  return { title, markdown: finalMarkdown, gates, writtenBy };
}
