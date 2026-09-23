import { describe, expect, it } from "vitest";
import { parseBrief } from "./brief";

const full = JSON.stringify({
  topic: "Managed IT support for law firms",
  pageType: "landing",
  tone: "professional",
  audience: "small law firms in Denver",
  keyFacts: ["24/7 helpdesk", "Response within 15 minutes"],
  brandName: "Acme IT",
  keywords: ["managed IT", "helpdesk"],
});

describe("parseBrief: turning a model's JSON into form values", () => {
  it("maps a well-formed response onto the form's fields", () => {
    const b = parseBrief(full)!;
    expect(b.topic).toBe("Managed IT support for law firms");
    expect(b.pageType).toBe("landing");
    expect(b.audience).toBe("small law firms in Denver");
    expect(b.brandName).toBe("Acme IT");
    // The form's textarea is newline-separated, the keyword input comma-separated.
    expect(b.keyFacts).toBe("24/7 helpdesk\nResponse within 15 minutes");
    expect(b.keywords).toBe("managed IT, helpdesk");
  });

  it("unwraps a ```json fence", () => {
    expect(parseBrief("```json\n" + full + "\n```")?.topic).toBe(
      "Managed IT support for law firms",
    );
    expect(parseBrief("```\n" + full + "\n```")?.topic).toBeTruthy();
  });

  it("accepts key facts as a newline string instead of an array", () => {
    const b = parseBrief(
      JSON.stringify({ topic: "T", keyFacts: "one\ntwo\n\nthree" }),
    )!;
    expect(b.keyFacts).toBe("one\ntwo\nthree");
  });

  it("strips bullet markers the model adds to its own list items", () => {
    const b = parseBrief(JSON.stringify({ topic: "T", keyFacts: ["- one", "• two", "* three"] }))!;
    expect(b.keyFacts).toBe("one\ntwo\nthree");
  });

  it("falls back to a landing page for an unknown or missing page type", () => {
    expect(parseBrief(JSON.stringify({ topic: "T", pageType: "listicle" }))?.pageType).toBe(
      "landing",
    );
    expect(parseBrief(JSON.stringify({ topic: "T" }))?.pageType).toBe("landing");
  });

  it("keeps a valid non-default page type", () => {
    expect(parseBrief(JSON.stringify({ topic: "T", pageType: "FAQ" }))?.pageType).toBe("faq");
  });

  it("defaults tone rather than leaving the field blank", () => {
    expect(parseBrief(JSON.stringify({ topic: "T" }))?.tone).toBe("professional");
  });

  it("returns null for a response that isn't usable", () => {
    // A brief with no topic can't seed the form's one required field.
    expect(parseBrief(JSON.stringify({ keyFacts: ["a"] }))).toBeNull();
    expect(parseBrief("not json at all")).toBeNull();
    expect(parseBrief("[]")).toBeNull();
    expect(parseBrief("")).toBeNull();
    expect(parseBrief(JSON.stringify({ topic: "   " }))).toBeNull();
  });

  it("carries no facts through when the model supplied none", () => {
    // Better an empty box the user fills than invented facts they don't notice.
    const b = parseBrief(JSON.stringify({ topic: "T", keyFacts: [] }))!;
    expect(b.keyFacts).toBe("");
  });

  it("survives wrong types without throwing", () => {
    const b = parseBrief(
      JSON.stringify({ topic: "T", keyFacts: 42, keywords: null, audience: 7 }),
    )!;
    expect(b.keyFacts).toBe("");
    expect(b.keywords).toBe("");
    expect(b.audience).toBe("");
  });
});
