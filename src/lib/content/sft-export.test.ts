import { describe, expect, it } from "vitest";
import type { ContentDraftRow } from "@/lib/db/schema";
import type { ContentInputs } from "./types";
import { serializeContentInputs, toTuningRow } from "./prompt";
import { buildContentSftDataset, TUNING_DATA_CUTOFF } from "./sft-export";

const inputs: ContentInputs = {
  topic: "How to pick a CRM",
  pageType: "blog",
  audience: "small law firms",
  tone: "professional",
  keyFacts: ["Fact A", "Fact B"],
  keywords: ["best crm"],
};

function draft(over: Partial<ContentDraftRow> = {}): ContentDraftRow {
  return {
    id: "d1",
    createdAt: new Date("2026-11-01T00:00:00Z"), // post-cutoff by default
    updatedAt: new Date("2026-11-01T00:00:00Z"),
    userId: "u1",
    topic: inputs.topic,
    targetUrl: null,
    inputs,
    title: "How to pick a CRM",
    markdown: "# How to pick a CRM\n\nLead with the answer.",
    humanFinal: null,
    gates: null,
    status: "approved",
    ...over,
  } as ContentDraftRow;
}

describe("serializeContentInputs / toTuningRow", () => {
  it("serializes the brief and builds a system+user+model row", () => {
    const text = serializeContentInputs(inputs);
    expect(text).toMatch(/Topic \/ title: How to pick a CRM/);
    expect(text).toMatch(/Page type: Blog \/ article/);
    expect(text).toMatch(/- Fact A/);

    const row = toTuningRow(inputs, "# Draft");
    expect(row.contents.map((c) => c.role)).toEqual(["user", "model"]);
    expect(row.contents[1].parts[0].text).toBe("# Draft");
  });
});

describe("buildContentSftDataset", () => {
  it("exports approved drafts, preferring the human-edited final", () => {
    const { rows } = buildContentSftDataset([draft({ humanFinal: "# Edited by a human" })]);
    expect(rows).toHaveLength(1);
    expect(rows[0].contents[1].parts[0].text).toBe("# Edited by a human");
  });

  it("excludes rejected and pending drafts", () => {
    expect(buildContentSftDataset([draft({ status: "rejected" })]).rows).toHaveLength(0);
    expect(buildContentSftDataset([draft({ status: "pending_review" })]).rows).toHaveLength(0);
  });

  it("excludes anything dated before the 2026-10-01 cutoff", () => {
    const old = draft({ createdAt: new Date("2026-09-30T23:59:59Z") });
    expect(buildContentSftDataset([old]).rows).toHaveLength(0);
    expect(TUNING_DATA_CUTOFF.toISOString()).toBe("2026-10-01T00:00:00.000Z");
  });

  it("skips a draft with no reconstructable brief", () => {
    expect(buildContentSftDataset([draft({ inputs: null })]).rows).toHaveLength(0);
  });
});
