import { describe, it, expect } from "vitest";
import { aiGates, capTotal, failedCaps, traditionalGates } from "./gates";
import { makePage } from "./test-fixtures";

describe("aiGates / traditionalGates", () => {
  it("all pass on a healthy page", () => {
    expect(aiGates(makePage()).every((g) => g.passed)).toBe(true);
    expect(traditionalGates(makePage()).every((g) => g.passed)).toBe(true);
  });

  it("flags blocked AI crawlers as a failed fundamental", () => {
    const crawl = aiGates(makePage({ robotsAllowsAiBots: false })).find(
      (g) => g.id === "crawlable",
    )!;
    expect(crawl.passed).toBe(false);
    expect(crawl.ceiling).toBe(40);
  });

  it("flags a JS shell, a non-200, and thin content for AI", () => {
    const gates = aiGates(
      makePage({ statusCode: 500, hasServerRenderedContent: false, wordCount: 20 }),
    );
    const failed = gates.filter((g) => !g.passed).map((g) => g.id).sort();
    expect(failed).toEqual(["reachable", "renderable", "substantive"]);
  });

  it("flags HTTP, missing title, and thin content for traditional", () => {
    const gates = traditionalGates(
      makePage({ url: "http://example.com/", title: null, wordCount: 20 }),
    );
    const failed = gates.filter((g) => !g.passed).map((g) => g.id).sort();
    expect(failed).toEqual(["identified", "secure", "substantive"]);
  });
});

describe("failedCaps + capTotal", () => {
  it("returns no caps and leaves the total alone when all fundamentals pass", () => {
    const caps = failedCaps(aiGates(makePage()));
    expect(caps).toEqual([]);
    expect(capTotal(93, caps)).toBe(93);
  });

  it("caps the total at the LOWEST ceiling among failed fundamentals", () => {
    // Blocked crawlers (40) and a JS shell (50) both fail → ceiling 40.
    const caps = failedCaps(
      aiGates(makePage({ robotsAllowsAiBots: false, hasServerRenderedContent: false })),
    );
    expect(caps.map((c) => c.id).sort()).toEqual(["crawlable", "renderable"]);
    expect(capTotal(95, caps)).toBe(40);
  });

  it("never raises a score — a weak total below the ceiling is untouched", () => {
    const caps = failedCaps(aiGates(makePage({ robotsAllowsAiBots: false })));
    expect(capTotal(12, caps)).toBe(12);
  });
});
