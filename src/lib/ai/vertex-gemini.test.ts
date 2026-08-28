import { afterEach, describe, expect, it } from "vitest";
import { contentWriterProvider } from "@/lib/content/generate";
import { parseVertexEndpoint } from "./vertex-gemini";

const ORIGINAL_ENDPOINT = process.env.CONTENT_WRITER_VERTEX_ENDPOINT;
const ORIGINAL_MODEL = process.env.GEMINI_GENERATOR_MODEL;

afterEach(() => {
  if (ORIGINAL_ENDPOINT === undefined) delete process.env.CONTENT_WRITER_VERTEX_ENDPOINT;
  else process.env.CONTENT_WRITER_VERTEX_ENDPOINT = ORIGINAL_ENDPOINT;

  if (ORIGINAL_MODEL === undefined) delete process.env.GEMINI_GENERATOR_MODEL;
  else process.env.GEMINI_GENERATOR_MODEL = ORIGINAL_MODEL;
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

  it("keeps the existing base Gemini path when no Vertex endpoint is configured", () => {
    delete process.env.CONTENT_WRITER_VERTEX_ENDPOINT;
    delete process.env.GEMINI_GENERATOR_MODEL;
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
});
