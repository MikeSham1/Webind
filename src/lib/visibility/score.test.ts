import { describe, it, expect } from "vitest";
import type { AnswerEngine, EngineVisibility } from "./types";
import {
  buildVisibilityReport,
  scoreKeyword,
  summarizeKeyword,
} from "./score";

function eng(
  engine: AnswerEngine,
  present: boolean | null,
  prominence: number | null = null,
  competitors: string[] = [],
): EngineVisibility {
  return {
    engine,
    configured: present !== null,
    present,
    prominence,
    competitors,
    evidence: null,
  };
}

describe("scoreKeyword", () => {
  it("averages only engines with a definite verdict", () => {
    // present@80, present@60, and one unknown (excluded): (80+60)/2 = 70.
    const score = scoreKeyword([
      eng("claude", true, 80),
      eng("openai", true, 60),
      eng("gemini", null),
    ]);
    expect(score).toBe(70);
  });

  it("counts an absent engine as zero, not as unknown", () => {
    // present@100 and absent@0 → 50; the null engine must not enter the mean.
    expect(
      scoreKeyword([eng("claude", true, 100), eng("openai", false), eng("gemini", null)]),
    ).toBe(50);
  });

  it("credits a present-but-unranked mention below a top recommendation", () => {
    const ranked = scoreKeyword([eng("claude", true, 100)]);
    const unranked = scoreKeyword([eng("claude", true, null)]);
    expect(ranked).toBe(100);
    expect(unranked).toBe(70); // DEFAULT_PRESENT_PROMINENCE
    expect(unranked as number).toBeLessThan(ranked as number);
  });

  it("returns null when nothing could be measured", () => {
    expect(scoreKeyword([eng("claude", null), eng("openai", null)])).toBeNull();
  });
});

describe("buildVisibilityReport", () => {
  const query = {
    domain: "acme.com",
    brandName: "Acme",
    keywords: ["best widgets", "durable widgets"],
  };

  it("averages overall over keywords with a definite score", () => {
    const report = buildVisibilityReport(query, [
      summarizeKeyword("best widgets", [eng("claude", true, 80)]),
      summarizeKeyword("durable widgets", [eng("claude", false)]),
    ]);
    expect(report.overallScore).toBe(40); // (80 + 0) / 2
    expect(report.brandName).toBe("Acme");
  });

  it("reports coverage as the definite share of the probe matrix", () => {
    // 2 keywords × 2 engines = 4 cells; 3 definite, 1 unknown → 0.75.
    const report = buildVisibilityReport(query, [
      summarizeKeyword("best widgets", [
        eng("claude", true, 80),
        eng("openai", false),
      ]),
      summarizeKeyword("durable widgets", [
        eng("claude", true, 60),
        eng("openai", null),
      ]),
    ]);
    expect(report.coverage).toBeCloseTo(0.75);
  });

  it("is null overall (not zero) when no engine ran, with a customer-facing message — not an env var to set", () => {
    const report = buildVisibilityReport(query, [
      summarizeKeyword("best widgets", [eng("claude", null)]),
    ]);
    expect(report.overallScore).toBeNull();
    expect(report.recommendations[0]).not.toMatch(/API_KEY|env(ironment)? var/i);
    expect(report.recommendations[0]).toMatch(/support/i);
  });

  it("ranks competitors by citation frequency and normalizes them", () => {
    const report = buildVisibilityReport(query, [
      summarizeKeyword("best widgets", [
        eng("claude", false, null, ["https://www.WidgetCo.com/", "GadgetPro"]),
      ]),
      summarizeKeyword("durable widgets", [
        eng("claude", false, null, ["widgetco.com", "GadgetPro"]),
      ]),
    ]);
    // widgetco.com and gadgetpro each cited twice; www./scheme collapsed.
    expect(report.topCompetitors.slice(0, 2).sort()).toEqual([
      "gadgetpro",
      "widgetco.com",
    ]);
  });

  it("recommends closing the weakest measured keywords first, naming rivals", () => {
    const report = buildVisibilityReport(query, [
      summarizeKeyword("best widgets", [eng("claude", true, 90)]), // strong, no gap
      summarizeKeyword("durable widgets", [
        eng("claude", false, null, ["widgetco.com"]),
      ]),
    ]);
    expect(report.recommendations[0]).toMatch(/durable widgets/);
    expect(report.recommendations[0]).toMatch(/widgetco\.com/);
    // The strong keyword is not flagged as a gap.
    expect(report.recommendations.join(" ")).not.toMatch(/best widgets/);
  });

  it("congratulates when every measured keyword is visible", () => {
    const report = buildVisibilityReport(query, [
      summarizeKeyword("best widgets", [eng("claude", true, 90)]),
      summarizeKeyword("durable widgets", [eng("claude", true, 85)]),
    ]);
    expect(report.overallScore).toBeGreaterThanOrEqual(80);
    expect(report.recommendations).toHaveLength(1);
    expect(report.recommendations[0]).toMatch(/surfacing well/);
  });

  it("lists only engines that actually ran", () => {
    const report = buildVisibilityReport(query, [
      summarizeKeyword("best widgets", [
        eng("claude", true, 80),
        eng("openai", null), // configured:false via helper
      ]),
    ]);
    expect(report.enginesUsed).toEqual(["claude"]);
  });
});
