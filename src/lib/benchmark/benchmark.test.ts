import { afterEach, describe, expect, it, vi } from "vitest";
import type { CrawledPage, ReportResult } from "@/lib/scoring/types";
import {
  competitivePercentile,
  empiricalPercentile,
  shrinkToward50,
} from "./percentile";
import { buildCohort, domainOf } from "./cohort";
import { serperSearch } from "./serper";
import { runBenchmark } from "./benchmark";
import type { SerpResult } from "./types";

// --- percentile ------------------------------------------------------------

describe("empiricalPercentile", () => {
  it("is the share of the cohort at or below the value", () => {
    expect(empiricalPercentile(50, [10, 20, 30, 40])).toBe(100);
    expect(empiricalPercentile(25, [10, 20, 30, 40])).toBe(50);
    expect(empiricalPercentile(5, [10, 20, 30, 40])).toBe(0);
  });
  it("defaults to 50 with an empty cohort", () => {
    expect(empiricalPercentile(50, [])).toBe(50);
  });
});

describe("shrinkToward50", () => {
  it("pulls extremes toward 50 harder when n is small", () => {
    const small = shrinkToward50(100, 2);
    const large = shrinkToward50(100, 200);
    expect(small).toBeLessThan(large); // small cohort → more shrinkage
    expect(large).toBeGreaterThan(95); // big cohort → barely shrunk
  });
  it("never moves 50", () => {
    expect(shrinkToward50(50, 3)).toBeCloseTo(50, 6);
  });
});

describe("competitivePercentile", () => {
  it("returns null with no competitors", () => {
    expect(competitivePercentile(70, [])).toBeNull();
  });
  it("brackets the point estimate with a bootstrap band and is deterministic", () => {
    const cohort = [40, 45, 50, 55, 60, 65, 70];
    const a = competitivePercentile(58, cohort, { seed: 1 })!;
    const b = competitivePercentile(58, cohort, { seed: 1 })!;
    expect(a).toEqual(b); // same seed → identical
    expect(a.lo).toBeLessThanOrEqual(a.value);
    expect(a.hi).toBeGreaterThanOrEqual(a.value);
    expect(a.n).toBe(7);
  });
  it("ranks a strong page high and a weak page low", () => {
    const cohort = [30, 40, 50, 60, 70, 80];
    const strong = competitivePercentile(90, cohort, { seed: 2 })!;
    const weak = competitivePercentile(20, cohort, { seed: 2 })!;
    expect(strong.value).toBeGreaterThan(weak.value);
  });
});

// --- cohort ----------------------------------------------------------------

describe("domainOf", () => {
  it("strips scheme and www, lowercases", () => {
    expect(domainOf("https://www.Acme.com/pricing")).toBe("acme.com");
    expect(domainOf("rival.io")).toBe("rival.io");
    expect(domainOf("not a url")).toBeNull();
  });
});

describe("buildCohort", () => {
  const results: SerpResult[] = [
    { position: 1, link: "https://acme.com/", title: "Acme" }, // target — excluded
    { position: 2, link: "https://rival.com/a", title: "Rival A" },
    { position: 3, link: "https://rival.com/b", title: "Rival A dup" }, // dedupe domain
    { position: 4, link: "https://youtube.com/watch", title: "YT" }, // non-competitor
    { position: 12, link: "https://nearmiss.io/", title: "Near" },
    { position: 40, link: "https://toolow.com/", title: "Too low" }, // out of 1-30
  ];

  it("excludes the target, dedupes domains, filters non-competitors, and labels cohorts", () => {
    const cohort = buildCohort(results, { targetDomain: "www.acme.com" });
    const domains = cohort.map((c) => c.domain);
    expect(domains).toEqual(["rival.com", "nearmiss.io"]);
    expect(cohort[0].position).toBe(2); // best position kept for rival.com
    expect(cohort[0].cohort).toBe("top");
    expect(cohort[1].cohort).toBe("near");
  });

  it("caps the cohort size", () => {
    const many: SerpResult[] = Array.from({ length: 20 }, (_, i) => ({
      position: i + 1,
      link: `https://site${i}.com/`,
      title: `S${i}`,
    }));
    expect(buildCohort(many, { targetDomain: "acme.com", max: 5 })).toHaveLength(5);
  });
});

// --- serper client ---------------------------------------------------------

describe("serperSearch", () => {
  const saved = process.env.SERPER_API_KEY;
  afterEach(() => {
    if (saved === undefined) delete process.env.SERPER_API_KEY;
    else process.env.SERPER_API_KEY = saved;
    vi.restoreAllMocks();
  });

  it("degrades to not-configured with no key", async () => {
    delete process.env.SERPER_API_KEY;
    const r = await serperSearch("best crm");
    expect(r.ok).toBe(false);
  });

  it("parses organic rows and sends the key header", async () => {
    process.env.SERPER_API_KEY = "test-key";
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({
          organic: [
            { position: 1, link: "https://a.com/", title: "A", snippet: "hi" },
            { position: 2, link: "https://b.com/", title: "B" },
            { title: "no link — dropped" },
          ],
        }),
        { status: 200 },
      ),
    ) as unknown as typeof fetch;

    const r = await serperSearch("best crm", { fetchImpl });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.results).toHaveLength(2);
    expect(r.results[0].link).toBe("https://a.com/");
    const [, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect((init.headers as Record<string, string>)["X-API-KEY"]).toBe("test-key");
  });

  it("returns an error on a non-200 without throwing", async () => {
    process.env.SERPER_API_KEY = "test-key";
    const fetchImpl = vi.fn(async () => new Response("nope", { status: 429 })) as unknown as typeof fetch;
    const r = await serperSearch("x", { fetchImpl });
    expect(r.ok).toBe(false);
  });
});

// --- orchestrator ----------------------------------------------------------

describe("runBenchmark", () => {
  it("degrades to a not-configured report when no SERP dep or key is present", async () => {
    const prev = process.env.SERPER_API_KEY;
    delete process.env.SERPER_API_KEY;
    const report = await runBenchmark({ url: "https://target.com/", query: "best crm" });
    expect(report.configured).toBe(false);
    expect(report.note).toMatch(/SERPER_API_KEY/);
    if (prev !== undefined) process.env.SERPER_API_KEY = prev;
  });

  it("scores the target against a crawled cohort and reports a percentile", async () => {
    // Per-URL scores via a crawl that stashes the score on the returned page.
    const table: Record<string, number> = {
      "target.com": 80,
      "r1.com": 40,
      "r2.com": 50,
      "r3.com": 60,
    };
    const report = await runBenchmark(
      { url: "https://target.com/", query: "best crm" },
      {
        search: async () => ({
          ok: true,
          results: [
            { position: 2, link: "https://r1.com/", title: "R1" },
            { position: 3, link: "https://r2.com/", title: "R2" },
            { position: 12, link: "https://r3.com/", title: "R3" },
          ],
        }),
        crawl: async (url: string) => ({ __domain: domainOf(url) }) as unknown as CrawledPage,
        score: (page: CrawledPage): ReportResult => {
          const domain = (page as unknown as { __domain: string }).__domain;
          const total = table[domain] ?? 0;
          return { ai: { total }, traditional: { total } } as ReportResult;
        },
      },
    );

    expect(report.configured).toBe(true);
    expect(report.target.ai).toBe(80);
    expect(report.competitors).toHaveLength(3);
    // 80 beats all three rivals (40/50/60) → high percentile.
    expect(report.aiPercentile).not.toBeNull();
    expect(report.aiPercentile!.value).toBeGreaterThan(60);
    expect(report.note).toMatch(/3 of 3 competitors/);
  });

  it("records a rival that won't crawl but still ranks against the rest", async () => {
    const report = await runBenchmark(
      { url: "https://target.com/", query: "best crm" },
      {
        search: async () => ({
          ok: true,
          results: [
            { position: 2, link: "https://ok.com/", title: "ok" },
            { position: 3, link: "https://broken.com/", title: "broken" },
          ],
        }),
        crawl: async (url: string) => {
          if (domainOf(url) === "broken.com") throw new Error("boom");
          return { __domain: domainOf(url) } as unknown as CrawledPage;
        },
        score: (page: CrawledPage): ReportResult => {
          const domain = (page as unknown as { __domain: string }).__domain;
          const total = domain === "target.com" ? 70 : 50;
          return { ai: { total }, traditional: { total } } as ReportResult;
        },
      },
    );
    const broken = report.competitors.find((c) => c.domain === "broken.com")!;
    expect(broken.ok).toBe(false);
    expect(broken.ai).toBeNull();
    // The percentile is computed over the one rival that did score.
    expect(report.aiPercentile!.n).toBe(1);
    expect(report.note).toMatch(/1 of 2/);
  });
});
