import { describe, it, expect, vi } from "vitest";
import { checkKeywordVisibility, MAX_KEYWORDS, MAX_SAMPLES } from "./check";
import { detectVisibility, type VisibilityProvider } from "./providers";

type Verdict = Awaited<ReturnType<VisibilityProvider["probe"]>>;

/** A configured stub provider whose probe returns a fixed verdict. */
function stub(
  engine: VisibilityProvider["engine"],
  verdict: Partial<Verdict>,
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

/** A stub that walks a scripted sequence of verdicts across successive probes. */
function sequenceStub(
  engine: VisibilityProvider["engine"],
  verdicts: Partial<Verdict>[],
): VisibilityProvider {
  let i = 0;
  return {
    engine,
    isConfigured: () => true,
    probe: vi.fn(async () => {
      const v = verdicts[Math.min(i, verdicts.length - 1)];
      i += 1;
      return { present: null, prominence: null, competitors: [], evidence: null, ...v };
    }),
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

  it("pools repeated probes into a citation rate with a credible interval", async () => {
    // Stochastic engine: present, present, absent over three probes.
    const claude = sequenceStub("claude", [
      { present: true, prominence: 80 },
      { present: true, prominence: 60 },
      { present: false },
    ]);
    const result = await checkKeywordVisibility(
      { domain: "acme.com", brandName: "Acme", keywords: ["best widgets"] },
      { providers: [claude], samples: 3 },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(claude.probe).toHaveBeenCalledTimes(3);
    const eng = result.report.keywords[0].engines[0];
    expect(eng.samples).toBe(3);
    expect(eng.hits).toBe(2);
    expect(eng.present).toBe(true); // 2/3 majority
    expect(eng.prominence).toBe(70); // mean of 80 and 60
    expect(eng.evidence).toMatch(/2\/3 probes/);

    const rate = result.report.visibilityRate!;
    expect(rate.hits).toBe(2);
    expect(rate.samples).toBe(3);
    expect(rate.rate).toBeCloseTo(3 / 5, 5); // Beta(3,2) mean = 0.6
    expect(rate.lo).toBeLessThan(rate.rate);
    expect(rate.hi).toBeGreaterThan(rate.rate);
  });

  it("treats a single probe as one Beta trial with an honestly wide interval", async () => {
    const claude = stub("claude", { present: true, prominence: 90 });
    const result = await checkKeywordVisibility(
      { domain: "acme.com", keywords: ["best widgets"] },
      { providers: [claude] }, // default samples = 1
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const rate = result.report.visibilityRate!;
    expect(rate.samples).toBe(1);
    expect(rate.hits).toBe(1);
    // One probe is weak evidence — the interval must be wide.
    expect(rate.hi - rate.lo).toBeGreaterThan(0.6);
  });

  it("caps samples at MAX_SAMPLES", async () => {
    const claude = stub("claude", { present: true, prominence: 50 });
    const result = await checkKeywordVisibility(
      { domain: "acme.com", keywords: ["x"] },
      { providers: [claude], samples: 99 },
    );
    expect(result.ok).toBe(true);
    expect(claude.probe).toHaveBeenCalledTimes(MAX_SAMPLES);
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

describe("detectVisibility (unbiased)", () => {
  const ctx = { domain: "acme.com", brandName: "Acme" };

  it("marks present with high prominence when the brand ranks first", () => {
    const v = detectVisibility(
      "Here are the best options...\nSOURCES: Acme, WidgetCo, gadgetpro.io",
      ctx,
    );
    expect(v.present).toBe(true);
    expect(v.prominence).toBeGreaterThanOrEqual(70);
    expect(v.competitors).toEqual(["WidgetCo", "gadgetpro.io"]);
  });

  it("marks not-present and captures the competitors that surfaced instead", () => {
    const v = detectVisibility("Try these.\nSOURCES: RivalCo, othersite.io", ctx);
    expect(v.present).toBe(false);
    expect(v.prominence).toBeNull();
    expect(v.competitors).toEqual(["RivalCo", "othersite.io"]);
  });

  it("detects the brand by domain match, not just name", () => {
    const v = detectVisibility("SOURCES: widgetco.com, acme.com", ctx);
    expect(v.present).toBe(true);
    expect(v.competitors).toEqual(["widgetco.com"]);
  });

  it("detects a prose mention even with no SOURCES line", () => {
    const v = detectVisibility("Acme is a strong choice here.", ctx);
    expect(v.present).toBe(true);
    expect(v.prominence).toBe(35);
  });

  it("returns unknown when nothing came back", () => {
    expect(detectVisibility("", ctx).present).toBeNull();
  });
});
