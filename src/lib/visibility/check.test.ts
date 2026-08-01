import { describe, it, expect, vi } from "vitest";
import { checkKeywordVisibility, MAX_KEYWORDS } from "./check";
import { parseVerdict, type VisibilityProvider } from "./providers";

/** A configured stub provider whose probe returns a fixed verdict. */
function stub(
  engine: VisibilityProvider["engine"],
  verdict: Partial<Awaited<ReturnType<VisibilityProvider["probe"]>>>,
  configured = true,
): VisibilityProvider {
  return {
    engine,
    isConfigured: () => configured,
    probe: vi.fn(async () => ({
      present: null,
      prominence: null,
      competitors: [],
      evidence: null,
      ...verdict,
    })),
  };
}

const query = {
  domain: "https://acme.com/",
  brandName: "Acme",
  keywords: ["best widgets", "durable widgets"],
};

describe("checkKeywordVisibility", () => {
  it("probes every keyword against every provider and scores the run", async () => {
    const claude = stub("claude", { present: true, prominence: 90 });
    const result = await checkKeywordVisibility(query, { providers: [claude] });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.report.domain).toBe("acme.com"); // normalized from the URL
    expect(result.report.keywords).toHaveLength(2);
    expect(result.report.overallScore).toBe(90);
    expect(result.report.coverage).toBe(1);
    expect(claude.probe).toHaveBeenCalledTimes(2);
  });

  it("degrades a throwing provider to an unknown verdict instead of aborting", async () => {
    const flaky: VisibilityProvider = {
      engine: "openai",
      isConfigured: () => true,
      probe: vi.fn(async () => {
        throw new Error("boom");
      }),
    };
    const claude = stub("claude", { present: true, prominence: 80 });

    const result = await checkKeywordVisibility(query, {
      providers: [claude, flaky],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // The failure is recorded but excluded from the score (claude still counts).
    const first = result.report.keywords[0];
    const openai = first.engines.find((e) => e.engine === "openai")!;
    expect(openai.present).toBeNull();
    expect(openai.evidence).toMatch(/Check failed: boom/);
    expect(result.report.overallScore).toBe(80);
  });

  it("returns a report with null scores when no engine is configured", async () => {
    const idle = stub("claude", {}, false);
    const result = await checkKeywordVisibility(query, { providers: [idle] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.report.overallScore).toBeNull();
    expect(result.report.enginesUsed).toEqual([]);
    expect(idle.probe).not.toHaveBeenCalled();
  });

  it("rejects an invalid domain without probing", async () => {
    const claude = stub("claude", { present: true });
    const result = await checkKeywordVisibility(
      { domain: "not a url", keywords: ["x"] },
      { providers: [claude] },
    );
    expect(result.ok).toBe(false);
    expect(claude.probe).not.toHaveBeenCalled();
  });

  it("rejects an internal domain (reuses the SSRF-aware normalizer)", async () => {
    const result = await checkKeywordVisibility({
      domain: "http://localhost:3000",
      keywords: ["x"],
    });
    expect(result.ok).toBe(false);
  });

  it("rejects a run with no usable keywords", async () => {
    const result = await checkKeywordVisibility({
      domain: "acme.com",
      keywords: ["   ", ""],
    });
    expect(result.ok).toBe(false);
  });

  it("dedupes keywords case-insensitively and caps the count", async () => {
    const claude = stub("claude", { present: true, prominence: 50 });
    const many = Array.from({ length: MAX_KEYWORDS + 5 }, (_, i) => `kw ${i}`);
    const result = await checkKeywordVisibility(
      { domain: "acme.com", keywords: ["dup", "DUP", ...many] },
      { providers: [claude] },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // "dup"/"DUP" collapse to one, and the total is capped.
    expect(result.report.keywords).toHaveLength(MAX_KEYWORDS);
    expect(result.report.keywords[0].keyword).toBe("dup");
  });
});

describe("parseVerdict", () => {
  it("parses a well-formed trailer", () => {
    const v = parseVerdict(
      "Some analysis.\nPRESENT: yes\nPROMINENCE: 85\nCOMPETITORS: WidgetCo, gadgetpro.io\nEVIDENCE: Cited by two industry roundups.",
    );
    expect(v.present).toBe(true);
    expect(v.prominence).toBe(85);
    expect(v.competitors).toEqual(["WidgetCo", "gadgetpro.io"]);
    expect(v.evidence).toBe("Cited by two industry roundups.");
  });

  it("treats 'unknown' as null and ignores prominence when absent", () => {
    const v = parseVerdict("PRESENT: unknown\nPROMINENCE: n/a\nCOMPETITORS: none\nEVIDENCE: Couldn't tell.");
    expect(v.present).toBeNull();
    expect(v.prominence).toBeNull();
    expect(v.competitors).toEqual([]);
  });

  it("drops prominence when the brand is not present", () => {
    const v = parseVerdict("PRESENT: no\nPROMINENCE: 40\nCOMPETITORS: RivalCo\nEVIDENCE: Rival dominates.");
    expect(v.present).toBe(false);
    expect(v.prominence).toBeNull(); // prominence only meaningful when present
    expect(v.competitors).toEqual(["RivalCo"]);
  });

  it("falls back to the whole text when there is no trailer", () => {
    const v = parseVerdict("The model wandered off without a verdict.");
    expect(v.present).toBeNull();
    expect(v.evidence).toMatch(/wandered off/);
  });
});
