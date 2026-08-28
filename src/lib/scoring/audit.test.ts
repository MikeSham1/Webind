import { describe, expect, it } from "vitest";
import type { AiProvider, GenerateResult } from "@/lib/ai/types";
import { buildReport } from "./report";
import { makePage } from "./test-fixtures";
import { auditReport } from "./audit";

const report = buildReport(makePage({ url: "https://acme.com/" }));
const page = makePage({ url: "https://acme.com/" });

/** A fake provider that returns a fixed text (or throws / reports fallback). */
function fakeProvider(opts: {
  configured?: boolean;
  text?: string;
  fallback?: boolean;
  throws?: boolean;
}): AiProvider {
  return {
    name: "fake",
    model: "fake-1",
    isConfigured: () => opts.configured ?? true,
    async generate(): Promise<GenerateResult> {
      if (opts.throws) throw new Error("boom");
      return {
        provider: "fake",
        model: "fake-1",
        text: opts.text ?? "",
        inputTokens: 0,
        outputTokens: 0,
        durationMs: 1,
        purpose: "score_audit",
        fallback: opts.fallback ?? false,
      };
    },
  };
}

describe("auditReport", () => {
  it("reports not-configured when the provider has no key", async () => {
    const a = await auditReport(report, page, { provider: fakeProvider({ configured: false }) });
    expect(a.configured).toBe(false);
    expect(a.flags).toEqual([]);
  });

  it("keeps flags for real signal keys, drops unknown keys and 'plausible'", async () => {
    const text = JSON.stringify({
      flags: [
        { signalKey: "freshness", verdict: "too_low", severity: "medium", explanation: "Homepage doesn't need a date." },
        { signalKey: "not_a_signal", verdict: "too_high", severity: "high", explanation: "n/a" },
        { signalKey: "ai_total", verdict: "plausible", severity: "low", explanation: "fine" },
      ],
    });
    const a = await auditReport(report, page, { provider: fakeProvider({ text }) });
    expect(a.configured).toBe(true);
    expect(a.flags).toHaveLength(1);
    expect(a.flags[0].signalKey).toBe("freshness");
  });

  it("sorts flags by severity, high first", async () => {
    const text = JSON.stringify({
      flags: [
        { signalKey: "freshness", verdict: "too_low", severity: "low", explanation: "a" },
        { signalKey: "ai_total", verdict: "too_high", severity: "high", explanation: "b" },
      ],
    });
    const a = await auditReport(report, page, { provider: fakeProvider({ text }) });
    expect(a.flags.map((f) => f.severity)).toEqual(["high", "low"]);
  });

  it("salvages JSON wrapped in prose", async () => {
    const text =
      'Sure! Here is my review:\n{"flags":[{"signalKey":"ai_total","verdict":"too_high","severity":"high","explanation":"x"}]}\nHope that helps.';
    const a = await auditReport(report, page, { provider: fakeProvider({ text }) });
    expect(a.flags).toHaveLength(1);
    expect(a.flags[0].signalKey).toBe("ai_total");
  });

  it("returns an empty audit on a fallback result or a thrown error, without crashing", async () => {
    const fb = await auditReport(report, page, { provider: fakeProvider({ fallback: true, text: "{}" }) });
    expect(fb.configured).toBe(true);
    expect(fb.flags).toEqual([]);

    const thrown = await auditReport(report, page, { provider: fakeProvider({ throws: true }) });
    expect(thrown.configured).toBe(true);
    expect(thrown.flags).toEqual([]);
  });
});
