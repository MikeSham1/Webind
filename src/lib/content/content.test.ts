import { describe, it, expect } from "vitest";
import { assembleDraft } from "./assemble";
import {
  checkFabrication,
  checkOriginality,
  checkYmyl,
  runSafetyGates,
} from "./gates";
import { generateDraft } from "./generate";
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

describe("checkFabrication", () => {
  it("passes when every supplied fact appears in the draft", () => {
    const { markdown } = assembleDraft(inputs());
    expect(checkFabrication(inputs(), markdown).status).toBe("pass");
  });

  it("warns when a supplied fact is missing from the draft", () => {
    const res = checkFabrication(inputs(), "# Managed IT Support\n\nNothing here.");
    expect(res.status).toBe("warn");
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

  it("appends a disclaimer for YMYL drafts", () => {
    const draft = generateDraft(
      inputs({ topic: "Understanding your mortgage refinance options" }),
    );
    expect(draft.markdown).toMatch(/Disclaimer:/);
    expect(draft.gates.results.find((g) => g.key === "ymyl")?.status).toBe("warn");
  });

  it("does not append a disclaimer for a neutral draft", () => {
    const draft = generateDraft(inputs());
    expect(draft.markdown).not.toMatch(/Disclaimer:/);
  });
});
