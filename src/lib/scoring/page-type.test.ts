import { describe, expect, it } from "vitest";
import { classifyPageType } from "./page-type";
import { makePage } from "./test-fixtures";

describe("classifyPageType", () => {
  it("treats the root path as the homepage", () => {
    expect(classifyPageType(makePage({ url: "https://acme.com/" }))).toBe("homepage");
    expect(classifyPageType(makePage({ url: "https://acme.com" }))).toBe("homepage");
  });

  it("reads an explicit schema @type first (even inside @graph)", () => {
    expect(
      classifyPageType(
        makePage({
          url: "https://acme.com/x",
          jsonLdBlocks: [{ "@graph": [{ "@type": "BlogPosting" }] }],
        }),
      ),
    ).toBe("article");
    expect(
      classifyPageType(makePage({ url: "https://acme.com/x", jsonLdBlocks: [{ "@type": "Product" }] })),
    ).toBe("product");
    expect(
      classifyPageType(makePage({ url: "https://acme.com/x", jsonLdBlocks: [{ "@type": "CollectionPage" }] })),
    ).toBe("listing");
  });

  it("falls back to URL shape", () => {
    expect(classifyPageType(makePage({ url: "https://acme.com/blog/widgets" }))).toBe("article");
    expect(classifyPageType(makePage({ url: "https://acme.com/2024/03/news-item" }))).toBe("article");
    expect(classifyPageType(makePage({ url: "https://acme.com/products/widget-9" }))).toBe("product");
    expect(classifyPageType(makePage({ url: "https://acme.com/category/tools" }))).toBe("listing");
  });

  it("reads a bylined long-form page as an article without schema or a telltale URL", () => {
    expect(
      classifyPageType(
        makePage({ url: "https://acme.com/deep-dive", metaAuthor: "Jane Doe", wordCount: 1200 }),
      ),
    ).toBe("article");
  });

  it("defaults an unmarked interior page to 'other'", () => {
    expect(
      classifyPageType(makePage({ url: "https://acme.com/about", metaAuthor: null, jsonLdBlocks: [] })),
    ).toBe("other");
  });
});
