import { describe, it, expect } from "vitest";
import { assembleDraft } from "./assemble";
import {
  checkFactsCoverage,
  checkOriginality,
  checkYmyl,
  runSafetyGates,
} from "./gates";
import { generateDraft } from "./generate";
import { fakeProvider, setFakeResponse } from "@/lib/ai/generator";
import type { AiProvider } from "@/lib/ai/types";
import type { ContentInputs } from "./types";

function inputs(overrides: Partial<ContentInputs> = {}): ContentInputs {
  return {
    topic: "Managed IT Support",
    pageType: "landing",
    audience: "small businesses",
    tone: "professional",
    keyFacts: ["24/7 helpdesk", "Response within 15 minutes", "Based in Denver"],
    ...overrides,
  };
}

describe("assembleDraft", () => {
  it("uses only supplied facts and includes the title + each fact", () => {
    const { title, markdown } = assembleDraft(inputs());
    expect(title).toBe("Managed IT Support");
    expect(markdown).toContain("# Managed IT Support");
    expect(markdown).toContain("- 24/7 helpdesk");
    expect(markdown).toContain("- Response within 15 minutes");
    expect(markdown).toContain("small businesses");
  });
});

describe("checkFactsCoverage", () => {
  it("passes when every supplied fact appears in the draft", () => {
    const { markdown } = assembleDraft(inputs());
    expect(checkFactsCoverage(inputs(), markdown).status).toBe("pass");
  });

  it("warns when a supplied fact is missing from the draft", () => {
    const res = checkFactsCoverage(inputs(), "# Managed IT Support\n\nNothing here.");
    expect(res.status).toBe("warn");
  });

  it("still passes when the draft contains extra, unsupplied claims — this check cannot detect fabrication, only missing coverage", () => {
    const { markdown } = assembleDraft(inputs());
    const withInventedClaim = `${markdown}\n\n- Certified by the International Widget Board (invented)`;
    const res = checkFactsCoverage(inputs(), withInventedClaim);
    expect(res.status).toBe("pass");
    expect(res.detail).not.toMatch(/nothing invented|no fabricat/i);
  });
});

describe("checkYmyl", () => {
  it("passes for a neutral topic", () => {
    expect(checkYmyl(inputs()).status).toBe("pass");
  });

  it("warns on a medical topic", () => {
    const res = checkYmyl(
      inputs({ topic: "Diabetes treatment options", keyFacts: ["Discuss dosage"] }),
    );
    expect(res.status).toBe("warn");
    expect(res.detail).toMatch(/health\/medical/);
  });

  it("warns on a financial topic", () => {
    expect(checkYmyl(inputs({ topic: "Best retirement investment returns" })).status).toBe(
      "warn",
    );
  });
});

describe("checkOriginality", () => {
  it("is info when no existing content is supplied", () => {
    expect(checkOriginality(inputs(), "some draft").status).toBe("info");
  });

  it("blocks when the draft nearly duplicates existing content", () => {
    const text =
      "we provide managed it support for small businesses with a helpdesk that is open all day every day and fast response times across denver";
    const res = checkOriginality(inputs({ existingContent: text }), text);
    expect(res.status).toBe("block");
  });

  it("passes when the draft is distinct from existing content", () => {
    const res = checkOriginality(
      inputs({ existingContent: "completely unrelated cooking recipes about pasta and sauce" }),
      "# Managed IT Support\n\n- 24/7 helpdesk\n- Response within 15 minutes",
    );
    expect(res.status).toBe("pass");
  });
});

describe("runSafetyGates / generateDraft", () => {
  it("always includes the mandatory human-approval gate", () => {
    const report = runSafetyGates(inputs(), assembleDraft(inputs()).markdown);
    expect(report.results.some((r) => r.key === "approval")).toBe(true);
  });

  it("blocked is true when originality blocks", () => {
    const text =
      "managed it support for small businesses helpdesk open all day fast response denver based team";
    const report = runSafetyGates(inputs({ existingContent: text }), text);
    expect(report.blocked).toBe(true);
  });

  it("appends a disclaimer for YMYL drafts", async () => {
    const draft = await generateDraft(
      inputs({ topic: "Understanding your mortgage refinance options" }),
    );
    expect(draft.markdown).toMatch(/Disclaimer:/);
    expect(draft.gates.results.find((g) => g.key === "ymyl")?.status).toBe("warn");
  });

  it("does not append a disclaimer for a neutral draft", async () => {
    const draft = await generateDraft(inputs());
    expect(draft.markdown).not.toMatch(/Disclaimer:/);
  });

  it("writes with the AI provider when configured, taking its H1 as the title", async () => {
    setFakeResponse("# AI-Written Guide\n\nLead with the answer, then expand.");
    try {
      const draft = await generateDraft(inputs(), { provider: fakeProvider() });
      expect(draft.writtenBy).toBe("model");
      expect(draft.title).toBe("AI-Written Guide");
      expect(draft.markdown).toMatch(/Lead with the answer/);
      expect(draft.gates.results.length).toBeGreaterThan(0);
    } finally {
      setFakeResponse("{}");
    }
  });

  it("tries the next writer when the preferred provider fails", async () => {
    let preferredCalls = 0;
    let fallbackCalls = 0;
    const preferred: AiProvider = {
      name: "gemini",
      model: "vertex-tuned-test",
      isConfigured: () => true,
      async generate() {
        preferredCalls++;
        throw new Error("simulated Vertex auth failure");
      },
    };
    const base37: AiProvider = {
      name: "gemini",
      model: "gemini-3.7-flash",
      isConfigured: () => true,
      async generate(req) {
        fallbackCalls++;
        return {
          provider: "gemini",
          model: "gemini-3.7-flash",
          text: "# Base 3.7 Fallback\n\nGrounded fallback copy.",
          inputTokens: 1,
          outputTokens: 1,
          durationMs: 1,
          purpose: req.purpose,
          fallback: false,
        };
      },
    };

    const draft = await generateDraft(inputs(), { providers: [preferred, base37] });
    expect(preferredCalls).toBe(1);
    expect(fallbackCalls).toBe(1);
    expect(draft.writtenBy).toBe("model");
    expect(draft.title).toBe("Base 3.7 Fallback");
  });

  it("falls back to the deterministic template when the AI call fails", async () => {
    setFakeResponse(null);
    try {
      const draft = await generateDraft(inputs(), { provider: fakeProvider() });
      expect(draft.writtenBy).toBe("template");
      expect(draft.markdown).toBe(assembleDraft(inputs()).markdown);
    } finally {
      setFakeResponse("{}");
    }
  });
});
