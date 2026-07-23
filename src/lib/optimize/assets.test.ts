import { describe, it, expect } from "vitest";
import { makePage } from "../scoring/test-fixtures";
import {
  buildOptimizations,
  llmsTxtAsset,
  metaAsset,
  robotsAsset,
  schemaAsset,
} from "./assets";

describe("schemaAsset", () => {
  it("is null when Organization + WebSite are already present", () => {
    const page = makePage({
      jsonLdBlocks: [{ "@type": "Organization" }, { "@type": "WebSite" }],
    });
    expect(schemaAsset(page)).toBeNull();
  });

  it("generates JSON-LD with both types, the origin, and the title as name", () => {
    const page = makePage({
      url: "https://acme.com/pricing",
      title: "Acme Co",
      metaDescription: "We make widgets.",
      jsonLdBlocks: [],
    });
    const asset = schemaAsset(page)!;
    expect(asset.language).toBe("html");
    expect(asset.content).toContain('"@type": "Organization"');
    expect(asset.content).toContain('"@type": "WebSite"');
    expect(asset.content).toContain('"url": "https://acme.com"'); // origin, not full path
    expect(asset.content).toContain('"name": "Acme Co"');
    expect(asset.content).toContain('"description": "We make widgets."');
    expect(asset.content).toContain('<script type="application/ld+json">');
  });
});

describe("metaAsset", () => {
  it("is null when title and description both exist", () => {
    expect(metaAsset(makePage())).toBeNull();
  });

  it("generates only the missing description (title present)", () => {
    const page = makePage({
      title: "Has Title",
      metaDescription: null,
      renderedText: "Acme builds delightful widgets for teams that ship fast.",
    });
    const asset = metaAsset(page)!;
    expect(asset.content).not.toContain("<title>");
    expect(asset.content).toContain('<meta name="description"');
    expect(asset.content).toContain("Acme builds delightful widgets");
    expect(asset.whatItFixes).toContain("meta description");
  });

  it("escapes quotes/brackets in the generated description", () => {
    const page = makePage({
      metaDescription: null,
      renderedText: 'A "quote" & <tag> in text',
    });
    const asset = metaAsset(page)!;
    expect(asset.content).toContain("&quot;");
    expect(asset.content).toContain("&amp;");
    expect(asset.content).toContain("&lt;tag&gt;");
    expect(asset.content).not.toContain('"quote"'); // raw quotes escaped
  });
});

describe("llmsTxtAsset", () => {
  it("is null when the site already serves llms.txt", () => {
    expect(llmsTxtAsset(makePage({ hasLlmsTxt: true }))).toBeNull();
  });

  it("builds Markdown with name, description, and the origin link", () => {
    const page = makePage({
      hasLlmsTxt: false,
      url: "https://acme.com/",
      title: "Acme",
      metaDescription: "Widgets for teams.",
      headings: [
        { level: 1, text: "Home" },
        { level: 2, text: "Pricing" },
        { level: 3, text: "Ignored deep heading" },
      ],
    });
    const asset = llmsTxtAsset(page)!;
    expect(asset.language).toBe("markdown");
    expect(asset.content).toContain("# Acme");
    expect(asset.content).toContain("> Widgets for teams.");
    expect(asset.content).toContain("[Acme](https://acme.com)");
    expect(asset.content).toContain("- Pricing"); // h2 included
    expect(asset.content).not.toContain("Ignored deep heading"); // h3 excluded
  });
});

describe("robotsAsset", () => {
  it("is null when AI bots are allowed", () => {
    expect(robotsAsset(makePage({ robotsAllowsAiBots: true }))).toBeNull();
  });

  it("lists Allow rules for the major AI crawlers when blocked", () => {
    const asset = robotsAsset(makePage({ robotsAllowsAiBots: false }))!;
    expect(asset.content).toContain("User-agent: GPTBot");
    expect(asset.content).toContain("User-agent: ClaudeBot");
    expect(asset.content).toContain("User-agent: PerplexityBot");
    expect(asset.content).toContain("Allow: /");
  });
});

describe("buildOptimizations", () => {
  it("returns no assets for a fully-optimized page", () => {
    const page = makePage({
      jsonLdBlocks: [{ "@type": "Organization" }, { "@type": "WebSite" }],
    });
    expect(buildOptimizations(page).assets).toHaveLength(0);
  });

  it("returns one asset per deficiency", () => {
    const page = makePage({
      jsonLdBlocks: [],
      title: null,
      metaDescription: null,
      hasLlmsTxt: false,
      robotsAllowsAiBots: false,
    });
    const keys = buildOptimizations(page).assets.map((a) => a.key);
    expect(keys).toEqual(["schema", "meta", "llmstxt", "robots"]);
  });
});
