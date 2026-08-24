import { describe, it, expect } from "vitest";
import { makePage } from "../scoring/test-fixtures";
import { buildSnapshot } from "./snapshot";
import { extractEvidenceSpans, type EvidenceSpan } from "./evidence";
import { validateCandidate } from "./validators";
import type { FixCandidate, FixContextPackage } from "./types";

function ctx(overrides: Partial<FixContextPackage> = {}): FixContextPackage {
  const snapshot = buildSnapshot(
    makePage({
      title: "Acme Widgets",
      renderedText: "Acme sells widgets. Prices start at $42 for the basic model.",
      jsonLdBlocks: [{ "@type": "Product", name: "Acme Widget" }],
    }),
  );
  const evidenceSpans = extractEvidenceSpans(snapshot);
  return {
    snapshotHash: snapshot.contentHash,
    url: snapshot.url,
    host: snapshot.host,
    pageType: "product",
    locale: "en",
    diagnosis: "Missing meta description",
    diagnosisConfidence: "high",
    signalKey: "onPageOptimization",
    allowedCategory: "metadata",
    forbiddenActions: ["invent facts"],
    allowedTargets: ["<head>"],
    evidenceSpans,
    targetOutcome: "A meta description drawn from the page",
    relevantContent: "",
    ...overrides,
  };
}

function candidate(overrides: Partial<FixCandidate> = {}): FixCandidate {
  return {
    candidateId: "c1",
    action: "fix",
    category: "metadata",
    target: "<head>",
    before: null,
    after: "Acme sells widgets for small businesses.",
    rationale: "Summarizes the page.",
    evidenceSpanIds: [],
    confidence: "medium",
    applyVia: "github-snippet",
    noFixReason: null,
    ...overrides,
  };
}

const priceSpanId = (spans: EvidenceSpan[]) =>
  spans.find((s) => s.text.includes("$42"))?.spanId;

describe("validateCandidate", () => {
  it("accepts a grounded, in-surface metadata fix", () => {
    expect(validateCandidate(candidate(), ctx()).ok).toBe(true);
  });

  it("retains a no_fix with a reason code", () => {
    const r = validateCandidate(
      candidate({ action: "no_fix", after: null, target: null, category: null, noFixReason: "already_optimal" }),
      ctx(),
    );
    expect(r.ok).toBe(true);
  });

  it("rejects a no_fix with no reason", () => {
    const r = validateCandidate(candidate({ action: "no_fix", noFixReason: null }), ctx());
    expect(r.failures).toContain("no_fix without a reason code");
  });

  it("rejects an unknown evidence id", () => {
    const r = validateCandidate(candidate({ evidenceSpanIds: ["ev_999"] }), ctx());
    expect(r.failures.some((f) => /unknown evidence ids/.test(f))).toBe(true);
  });

  it("rejects an unsupported number that cites no evidence", () => {
    const r = validateCandidate(
      candidate({ after: "Trusted by 5,000 businesses since 2019." }),
      ctx(),
    );
    expect(r.failures.some((f) => /cites no evidence/.test(f))).toBe(true);
  });

  it("accepts a number that is present in the cited evidence", () => {
    const c = ctx();
    const id = priceSpanId(c.evidenceSpans)!;
    const r = validateCandidate(
      candidate({ after: "Acme widgets start at $42.", evidenceSpanIds: [id] }),
      c,
    );
    expect(r.ok).toBe(true);
  });

  it("rejects a number that is NOT in the cited evidence (fabricated)", () => {
    const c = ctx();
    const id = priceSpanId(c.evidenceSpans)!;
    const r = validateCandidate(
      candidate({ after: "Acme widgets start at $9,999.", evidenceSpanIds: [id] }),
      c,
    );
    expect(r.failures.some((f) => /unsupported factual tokens/.test(f))).toBe(true);
  });

  it("rejects a fix outside the approved edit surface", () => {
    const r = validateCandidate(candidate({ target: "/wp-admin" }), ctx());
    expect(r.failures.some((f) => /approved edit surface/.test(f))).toBe(true);
  });

  it("rejects FAQPage schema outright", () => {
    const r = validateCandidate(
      candidate({
        category: "schema",
        target: "<head>",
        after: '<script type="application/ld+json">{"@type":"FAQPage"}</script>',
      }),
      ctx({ allowedCategory: "schema", allowedTargets: ["<head>"] }),
    );
    expect(r.failures.some((f) => /forbidden schema type: FAQPage/.test(f))).toBe(true);
  });

  it("rejects a schema type not applicable to the page type", () => {
    const r = validateCandidate(
      candidate({
        category: "schema",
        after: '<script type="application/ld+json">{"@type":"Recipe"}</script>',
      }),
      ctx({ allowedCategory: "schema", allowedTargets: ["<head>"], pageType: "product" }),
    );
    expect(r.failures.some((f) => /not applicable to a product page/.test(f))).toBe(true);
  });

  it("accepts an applicable Product schema on a product page", () => {
    const c = ctx({ allowedCategory: "schema", allowedTargets: ["<head>"], pageType: "product" });
    const nameSpan = c.evidenceSpans.find((s) => s.text.includes("Acme Widget"))?.spanId;
    const r = validateCandidate(
      candidate({
        category: "schema",
        after: '<script type="application/ld+json">{"@type":"Product","name":"Acme Widget"}</script>',
        evidenceSpanIds: nameSpan ? [nameSpan] : [],
      }),
      c,
    );
    expect(r.ok).toBe(true);
  });
});
