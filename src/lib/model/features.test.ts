import { describe, it, expect } from "vitest";
import { makePage } from "../scoring/test-fixtures";
import { extractFeatures, FEATURE_NAMES, FEATURE_COUNT } from "./features";

describe("extractFeatures", () => {
  it("returns one numeric value per named feature, in order", () => {
    const x = extractFeatures(makePage());
    expect(x).toHaveLength(FEATURE_COUNT);
    expect(x.every((v) => typeof v === "number" && Number.isFinite(v))).toBe(true);
  });

  it("maps boolean crawl signals to 0/1 at the right slots", () => {
    const idx = (name: string) => FEATURE_NAMES.indexOf(name as never);
    const blocked = extractFeatures(
      makePage({ robotsAllowsAiBots: false, hasServerRenderedContent: false }),
    );
    expect(blocked[idx("robotsAllowsAiBots")]).toBe(0);
    expect(blocked[idx("hasServerRenderedContent")]).toBe(0);

    const open = extractFeatures(makePage());
    expect(open[idx("robotsAllowsAiBots")]).toBe(1);
    expect(open[idx("hasServerRenderedContent")]).toBe(1);
  });

  it("computes altRatio, treating an image-free page as unpenalized (ratio 1)", () => {
    const idx = FEATURE_NAMES.indexOf("altRatio" as never);
    expect(extractFeatures(makePage({ imageCount: 0, imagesWithAlt: 0 }))[idx]).toBe(1);
    expect(extractFeatures(makePage({ imageCount: 4, imagesWithAlt: 1 }))[idx]).toBe(0.25);
  });

  it("detects Organization/WebSite schema, including inside an @graph wrapper", () => {
    const idx = FEATURE_NAMES.indexOf("hasOrgOrWebsiteSchema" as never);
    expect(extractFeatures(makePage({ jsonLdBlocks: [] }))[idx]).toBe(0);
    expect(
      extractFeatures(makePage({ jsonLdBlocks: [{ "@type": "Organization" }] }))[idx],
    ).toBe(1);
    expect(
      extractFeatures(
        makePage({ jsonLdBlocks: [{ "@graph": [{ "@type": "WebSite" }] }] }),
      )[idx],
    ).toBe(1);
  });

  it("is deterministic", () => {
    const page = makePage();
    expect(extractFeatures(page)).toEqual(extractFeatures(page));
  });
});
