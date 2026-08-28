import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchFieldVitals, isPsiConfigured } from "./psi";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

/** A PSI response with the given page-level metric percentiles. */
function psiBody(metrics: Record<string, number>, key: "loadingExperience" | "originLoadingExperience" = "loadingExperience") {
  return {
    [key]: {
      metrics: Object.fromEntries(
        Object.entries(metrics).map(([k, v]) => [k, { percentile: v }]),
      ),
    },
  };
}

describe("fetchFieldVitals", () => {
  const saved = process.env.PSI_API_KEY;
  afterEach(() => {
    if (saved === undefined) delete process.env.PSI_API_KEY;
    else process.env.PSI_API_KEY = saved;
    vi.restoreAllMocks();
  });

  it("reports not-configured without a key (and isPsiConfigured is false)", async () => {
    delete process.env.PSI_API_KEY;
    expect(isPsiConfigured()).toBe(false);
    const r = await fetchFieldVitals("https://acme.com/");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("not-configured");
  });

  it("parses field metrics and rates them against Google thresholds", async () => {
    process.env.PSI_API_KEY = "test-key";
    const fetchImpl = vi.fn(async () =>
      jsonResponse(
        psiBody({
          LARGEST_CONTENTFUL_PAINT_MS: 2000, // good (<=2500)
          INTERACTION_TO_NEXT_PAINT: 350, // needs-improvement (<=500)
          CUMULATIVE_LAYOUT_SHIFT_SCORE: 30, // 0.30 → poor (>0.25)
        }),
      ),
    ) as unknown as typeof fetch;

    const r = await fetchFieldVitals("https://acme.com/", { fetchImpl });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.vitals.source).toBe("page");
    const byMetric = Object.fromEntries(r.vitals.metrics.map((m) => [m.metric, m]));
    expect(byMetric.LCP.rating).toBe("good");
    expect(byMetric.INP.rating).toBe("needs-improvement");
    expect(byMetric.CLS.value).toBeCloseTo(0.3, 6); // ×100 decoded
    expect(byMetric.CLS.rating).toBe("poor");
    // Overall is the worst metric.
    expect(r.vitals.overall).toBe("poor");
    // Sends the key.
    const calledUrl = String((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0]);
    expect(calledUrl).toContain("key=test-key");
  });

  it("falls back to origin-level data when the page has none", async () => {
    process.env.PSI_API_KEY = "test-key";
    const fetchImpl = vi.fn(async () =>
      jsonResponse(psiBody({ LARGEST_CONTENTFUL_PAINT_MS: 1800 }, "originLoadingExperience")),
    ) as unknown as typeof fetch;

    const r = await fetchFieldVitals("https://acme.com/page", { fetchImpl });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.vitals.source).toBe("origin");
    expect(r.vitals.overall).toBe("good");
  });

  it("reports no-field-data when neither page nor origin has metrics", async () => {
    process.env.PSI_API_KEY = "test-key";
    const fetchImpl = vi.fn(async () => jsonResponse({ lighthouseResult: {} })) as unknown as typeof fetch;
    const r = await fetchFieldVitals("https://new-site.com/", { fetchImpl });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("no-field-data");
  });

  it("degrades to an error result on a non-200 instead of throwing", async () => {
    process.env.PSI_API_KEY = "test-key";
    const fetchImpl = vi.fn(async () => jsonResponse({}, 500)) as unknown as typeof fetch;
    const r = await fetchFieldVitals("https://acme.com/", { fetchImpl });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("error");
  });
});
