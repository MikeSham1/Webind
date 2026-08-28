import { describe, expect, it } from "vitest";
import { scoreContentQuality } from "./quality";
import type { ContentInputs } from "./types";

const blogInputs: ContentInputs = {
  topic: "How to choose a commercial roofing contractor",
  pageType: "blog",
  audience: "facilities managers",
  tone: "professional",
  keyFacts: [],
  keywords: ["commercial roofing contractor", "flat roof repair"],
};

describe("scoreContentQuality", () => {
  it("rewards answerable structure and useful depth", () => {
    const weak = scoreContentQuality(blogInputs, [
      "# Roofing",
      "",
      "Commercial roofing contractor commercial roofing contractor commercial roofing contractor.",
    ].join("\n"));

    const strong = scoreContentQuality(blogInputs, [
      "# How to Choose a Commercial Roofing Contractor",
      "",
      "Choose a contractor by verifying licensing, insurance, comparable work, and the exact scope behind each bid.",
      "",
      "## What should you verify first?",
      "Start with credentials and proof of comparable projects. Ask for documentation directly from the relevant source when possible.",
      "",
      "- Current contractor license",
      "- Liability and workers' compensation coverage",
      "- Recent projects with a similar roof system",
      "- A written scope that identifies materials and exclusions",
      "",
      "## How should you compare bids?",
      "Compare bids against one shared scope. Separate material grade, tear-off work, disposal, warranty terms, and scheduling so a low price does not hide a smaller job.",
      "",
      "| Check | Why it matters |",
      "| --- | --- |",
      "| Scope | Prevents unlike-for-like comparisons |",
      "| Warranty | Shows who owns failures after installation |",
      "| References | Gives you evidence from comparable work |",
      "",
      "## What should make you cautious?",
      "Be cautious when a bidder will not document the scope, cannot provide comparable references, or pressures you to decide before you can verify credentials. For local licensing requirements, cite the relevant state or municipal authority.",
      "",
      "## When is flat roof repair enough?",
      "Repair can be appropriate when the problem is localized and the surrounding system still has useful life. The decision should come from an inspection and documented condition, not a generic age rule.",
      "",
      "A strong commercial roofing contractor should make the decision easier to audit. You should be able to see what is being installed, why it fits the roof, who is responsible for each part of the work, and what evidence supports the recommendation.",
      "",
      "Facilities teams can also ask bidders to explain access, safety planning, tenant disruption, weather contingencies, and how unexpected deck damage will be priced. Those details often matter as much as the headline quote because they determine whether the project remains predictable once work starts.",
      "",
      "Before signing, put the final scope, change-order process, payment milestones, warranty terms, and closeout documentation in writing. That creates a shared record for the contractor and the owner and reduces the chance that important assumptions are discovered only after work begins.",
    ].join("\n"));

    expect(strong.score).toBeGreaterThan(weak.score);
    expect(strong.dimensions.extractability).toBeGreaterThan(weak.dimensions.extractability);
    expect(weak.warnings.some((w) => w.includes("Thin"))).toBe(true);
  });

  it("penalizes obvious target-term repetition but not one natural short-page mention", () => {
    const natural = scoreContentQuality(
      { ...blogInputs, pageType: "landing" },
      "# Commercial Roofing Contractor\n\nA practical roofing partner for facilities teams.\n\n## Services\n- Inspections\n- Repairs\n- Replacement planning\n\n## Next step\nTalk with the team about your roof and priorities.",
    );
    const stuffed = scoreContentQuality(
      { ...blogInputs, pageType: "landing" },
      "# Commercial Roofing Contractor\n\nCommercial roofing contractor commercial roofing contractor commercial roofing contractor commercial roofing contractor commercial roofing contractor commercial roofing contractor commercial roofing contractor commercial roofing contractor commercial roofing contractor commercial roofing contractor.",
    );

    expect(natural.warnings.some((w) => w.includes("unusually often"))).toBe(false);
    expect(natural.dimensions.intent).toBeGreaterThan(stuffed.dimensions.intent);
    expect(stuffed.warnings.some((w) => w.includes("unusually often"))).toBe(true);
  });

  it("matches short target terms on token boundaries instead of inside other words", () => {
    const result = scoreContentQuality(
      {
        ...blogInputs,
        topic: "AI operations",
        keywords: ["AI"],
      },
      "# AI Operations\n\nTraining, claims, details, maintainability, and availability are discussed here.\n\n## Practical use\nAI can support a workflow when the team has a clear review process.",
    );

    expect(result.warnings.some((w) => w.includes("unusually often"))).toBe(false);
  });
});
