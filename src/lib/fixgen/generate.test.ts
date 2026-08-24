import { afterEach, describe, it, expect } from "vitest";
import { makePage } from "../scoring/test-fixtures";
import { fakeProvider, setFakeResponse } from "../ai/generator";
import { buildSnapshot } from "./snapshot";
import { buildMetaDescriptionContext, buildSchemaContext } from "./context";
import { generateFixes } from "./generate";
import type { FixContextPackage } from "./types";

function metaCtx(): FixContextPackage {
  const snap = buildSnapshot(
    makePage({
      metaDescription: null,
      title: "Acme Widgets",
      renderedText: "Acme sells durable widgets for small businesses across the country.",
    }),
  );
  const gate = buildMetaDescriptionContext(snap);
  if (gate.kind !== "context") throw new Error("expected a context");
  return gate.context;
}

afterEach(() => setFakeResponse("{}"));

describe("applicability gates", () => {
  it("returns no_fix when the meta description is already good", () => {
    const snap = buildSnapshot(
      makePage({ metaDescription: "A clear, well-sized description of the Acme widgets page for search." }),
    );
    expect(buildMetaDescriptionContext(snap)).toEqual({ kind: "no_fix", reason: "already_optimal" });
  });

  it("returns a context when the meta description is missing", () => {
    const snap = buildSnapshot(makePage({ metaDescription: null }));
    const gate = buildMetaDescriptionContext(snap);
    expect(gate.kind).toBe("context");
  });

  it("does not offer schema for a generic page type", () => {
    const snap = buildSnapshot(makePage({ jsonLdBlocks: [], headings: [] }));
    expect(buildSchemaContext(snap)).toEqual({ kind: "no_fix", reason: "not_applicable" });
  });
});

describe("generateFixes", () => {
  it("accepts a grounded candidate the model returns", async () => {
    const ctx = metaCtx();
    const titleId = ctx.evidenceSpans.find((s) => s.source === "title")!.spanId;
    setFakeResponse(
      JSON.stringify({
        candidates: [
          {
            action: "fix",
            target: "<head>",
            after: "Acme sells durable widgets for small businesses.",
            rationale: "Summarizes the page from its own content.",
            evidenceSpanIds: [titleId],
            confidence: "high",
          },
        ],
      }),
    );
    const out = await generateFixes(ctx, { provider: fakeProvider() });
    expect(out.accepted).toHaveLength(1);
    expect(out.accepted[0].category).toBe("metadata");
    expect(out.accepted[0].applyVia).toBe("github-snippet");
    expect(out.rejected).toHaveLength(0);
  });

  it("rejects a candidate that invents an unsupported statistic", async () => {
    const ctx = metaCtx();
    setFakeResponse(
      JSON.stringify({
        candidates: [
          {
            action: "fix",
            target: "<head>",
            after: "Trusted by 12,000 businesses since 2011.",
            rationale: "Adds social proof.",
            evidenceSpanIds: [],
            confidence: "high",
          },
        ],
      }),
    );
    const out = await generateFixes(ctx, { provider: fakeProvider() });
    expect(out.accepted).toHaveLength(0);
    expect(out.rejected[0].result.failures.some((f) => /cites no evidence/.test(f))).toBe(true);
  });

  it("retains a no_fix answer from the model", async () => {
    const ctx = metaCtx();
    setFakeResponse(
      JSON.stringify({ candidates: [{ action: "no_fix", noFixReason: "insufficient_evidence" }] }),
    );
    const out = await generateFixes(ctx, { provider: fakeProvider() });
    expect(out.accepted).toHaveLength(1);
    expect(out.accepted[0].action).toBe("no_fix");
    expect(out.accepted[0].noFixReason).toBe("insufficient_evidence");
  });

  it("degrades safely on malformed JSON (no accepted, no throw)", async () => {
    const ctx = metaCtx();
    setFakeResponse("not json at all");
    const out = await generateFixes(ctx, { provider: fakeProvider() });
    expect(out.accepted).toHaveLength(0);
    expect(out.rejected).toHaveLength(0);
  });

  it("degrades safely when the provider falls back (no key / error)", async () => {
    const ctx = metaCtx();
    setFakeResponse(null); // forces the fake to throw → fallback
    const out = await generateFixes(ctx, { provider: fakeProvider() });
    expect(out.generation.fallback).toBe(true);
    expect(out.accepted).toHaveLength(0);
  });

  it("never trusts the model's category — coerces to the allowed one", async () => {
    const ctx = metaCtx();
    const titleId = ctx.evidenceSpans.find((s) => s.source === "title")!.spanId;
    setFakeResponse(
      JSON.stringify({
        candidates: [
          {
            action: "fix",
            category: "content-structure", // model lies; must be ignored
            target: "<head>",
            after: "Acme sells durable widgets.",
            rationale: "x",
            evidenceSpanIds: [titleId],
            confidence: "medium",
          },
        ],
      }),
    );
    const out = await generateFixes(ctx, { provider: fakeProvider() });
    expect(out.accepted[0].category).toBe("metadata");
  });
});
