import { afterEach, describe, expect, it } from "vitest";
import {
  contentWriterProvider,
  contentWriterProviders,
} from "@/lib/content/generate";
import { parseVertexEndpoint } from "./vertex-gemini";

const ORIGINAL_ENDPOINT = process.env.CONTENT_WRITER_VERTEX_ENDPOINT;
const ORIGINAL_MODEL = process.env.GEMINI_GENERATOR_MODEL;
const ORIGINAL_THINKING = process.env.GEMINI_THINKING_LEVEL;

afterEach(() => {
  if (ORIGINAL_ENDPOINT === undefined) delete process.env.CONTENT_WRITER_VERTEX_ENDPOINT;
  else process.env.CONTENT_WRITER_VERTEX_ENDPOINT = ORIGINAL_ENDPOINT;

  if (ORIGINAL_MODEL === undefined) delete process.env.GEMINI_GENERATOR_MODEL;
  else process.env.GEMINI_GENERATOR_MODEL = ORIGINAL_MODEL;

  if (ORIGINAL_THINKING === undefined) delete process.env.GEMINI_THINKING_LEVEL;
  else process.env.GEMINI_THINKING_LEVEL = ORIGINAL_THINKING;
});

describe("Vertex tuned Gemini routing", () => {
  it("parses the endpoint resource emitted by a tuning job", () => {
    const endpoint = "projects/demo/locations/us-central1/endpoints/123456789";
    expect(parseVertexEndpoint(endpoint)).toEqual({
      project: "demo",
      location: "us-central1",
      endpoint,
    });
    expect(parseVertexEndpoint("gemini-3.5-flash")).toBeNull();
  });

  it("keeps the content base path pinned to Gemini 3.7 despite generic generator overrides", () => {
    delete process.env.CONTENT_WRITER_VERTEX_ENDPOINT;
    process.env.GEMINI_GENERATOR_MODEL = "some-other-gemini-model";
    process.env.GEMINI_THINKING_LEVEL = "LOW";
    const provider = contentWriterProvider();
    expect(provider.model).toBe("gemini-3.7-flash");
  });

  it("routes the writer to Vertex only when an explicit tuned endpoint is configured", () => {
    const endpoint = "projects/demo/locations/us-central1/endpoints/123456789";
    process.env.CONTENT_WRITER_VERTEX_ENDPOINT = endpoint;
    const provider = contentWriterProvider();
    expect(provider.model).toBe(endpoint);
    expect(provider.isConfigured()).toBe(true);
  });

  it("keeps base 3.7 behind Vertex as the runtime fallback", () => {
    const endpoint = "projects/demo/locations/us-central1/endpoints/123456789";
    process.env.CONTENT_WRITER_VERTEX_ENDPOINT = endpoint;
    expect(contentWriterProviders().map((p) => p.model)).toEqual([
      endpoint,
      "gemini-3.7-flash",
    ]);
  });
});
