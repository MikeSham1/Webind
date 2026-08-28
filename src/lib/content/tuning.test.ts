import { describe, expect, it } from "vitest";
import type { ContentDraftRow } from "@/lib/db/schema";
import type { ContentInputs } from "./types";
import { serializeContentInputs, toTuningRow } from "./prompt";
import { CONTENT_TUNING_SEED, seedTuningRows } from "./tuning-seed";
import { buildContentSftDataset, TUNING_DATA_CUTOFF } from "./sft-export";
import { buildContentTuningDataset, toJsonl } from "./tuning";

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
    expect(row.systemInstruction.parts[0].text).toMatch(/content writer/i);
    expect(row.contents.map((c) => c.role)).toEqual(["user", "model"]);
    expect(row.contents[1].parts[0].text).toBe("# Draft");
  });
});

describe("best-practices seed", () => {
  it("produces one row per seed example", () => {
    expect(seedTuningRows()).toHaveLength(CONTENT_TUNING_SEED.length);
  });

  it("stays placeholder-honest — no fabricated stats or prices in outputs", () => {
    for (const ex of CONTENT_TUNING_SEED) {
      expect(ex.output, `seed "${ex.inputs.topic}" has a raw percentage`).not.toMatch(/\d+\s?%/);
      expect(ex.output, `seed "${ex.inputs.topic}" has a raw price`).not.toMatch(/[$£€]\s?\d/);
    }
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
    // ...and the cutoff constant is exactly Oct 1, 2026 UTC.
    expect(TUNING_DATA_CUTOFF.toISOString()).toBe("2026-10-01T00:00:00.000Z");
  });

  it("skips a draft with no reconstructable brief", () => {
    expect(buildContentSftDataset([draft({ inputs: null })]).rows).toHaveLength(0);
  });
});

describe("buildContentTuningDataset", () => {
  it("concatenates seed then collected data, and can drop the seed", () => {
    const withSeed = buildContentTuningDataset([draft()]);
    expect(withSeed.seedCount).toBe(CONTENT_TUNING_SEED.length);
    expect(withSeed.dataCount).toBe(1);
    expect(withSeed.rows).toHaveLength(withSeed.seedCount + 1);

    const noSeed = buildContentTuningDataset([draft()], { includeSeed: false });
    expect(noSeed.seedCount).toBe(0);
    expect(noSeed.rows).toHaveLength(1);
  });

  it("emits JSON Lines (one object per line)", () => {
    const { rows } = buildContentTuningDataset([], { includeSeed: true });
    const jsonl = toJsonl(rows);
    const lines = jsonl.trim().split("\n");
    expect(lines).toHaveLength(rows.length);
    expect(() => JSON.parse(lines[0])).not.toThrow();
  });
});
