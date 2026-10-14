import { describe, it, expect } from "vitest";
import { extractPageData, pageDataToCsv } from "./extract-data";
import { makePage } from "../scoring/test-fixtures";

describe("extractPageData", () => {
  it("pulls organization, product, article and breadcrumbs from JSON-LD", () => {
    const data = extractPageData(
      makePage({
        url: "https://acme.com/widget",
        jsonLdBlocks: [
          {
            "@type": "LocalBusiness",
            name: "Acme Co",
            url: "https://acme.com",
            logo: { "@type": "ImageObject", url: "https://acme.com/logo.png" },
            contactPoint: { "@type": "ContactPoint", telephone: "+1-555-0100" },
            address: {
              "@type": "PostalAddress",
              streetAddress: "1 Main St",
              addressLocality: "Springfield",
              addressCountry: "US",
            },
            sameAs: ["https://x.com/acme", "https://linkedin.com/company/acme"],
          },
          {
            "@type": "WebPage",
            // Nested entities are found too.
            mainEntity: {
              "@type": "Product",
              name: "Widget",
              brand: { "@type": "Brand", name: "Acme" },
              sku: "W-1",
              offers: [
                {
                  "@type": "Offer",
                  price: 19.99,
                  priceCurrency: "USD",
                  availability: "https://schema.org/InStock",
                },
              ],
              aggregateRating: { "@type": "AggregateRating", ratingValue: "4.6", reviewCount: 120 },
            },
          },
          {
            "@type": ["BlogPosting"],
            headline: "Why widgets",
            author: [{ "@type": "Person", name: "Jane Doe" }],
            datePublished: "2026-01-02",
          },
          {
            "@type": "BreadcrumbList",
            itemListElement: [
              { "@type": "ListItem", position: 2, name: "Widgets" },
              { "@type": "ListItem", position: 1, item: { "@id": "/", name: "Home" } },
            ],
          },
        ],
        openGraph: { title: "Widget", image: "https://acme.com/w.png" },
        canonicalUrl: "https://acme.com/widget",
        headings: [
          { level: 1, text: "Widget" },
          { level: 2, text: "Specs" },
          { level: 3, text: "Size" },
          { level: 2, text: "Pricing" },
        ],
      }),
    );

    expect(data.organization).toEqual({
      name: "Acme Co",
      url: "https://acme.com",
      logo: "https://acme.com/logo.png",
      telephone: "+1-555-0100",
      email: null,
      address: "1 Main St, Springfield, US",
      sameAs: ["https://x.com/acme", "https://linkedin.com/company/acme"],
    });
    expect(data.product).toEqual({
      name: "Widget",
      brand: "Acme",
      sku: "W-1",
      price: "19.99",
      currency: "USD",
      availability: "InStock",
      rating: "4.6",
      reviewCount: "120",
    });
    expect(data.article).toMatchObject({ headline: "Why widgets", author: "Jane Doe", datePublished: "2026-01-02" });
    expect(data.breadcrumbs).toEqual(["Home", "Widgets"]);
    expect(data.schemaTypes).toEqual([
      "AggregateRating", "BlogPosting", "Brand", "BreadcrumbList", "ContactPoint",
      "ImageObject", "ListItem", "LocalBusiness", "Offer", "Person", "PostalAddress",
      "Product", "WebPage",
    ]);
    expect(data.h1).toBe("Widget");
    expect(data.h2s).toEqual(["Specs", "Pricing"]);
    expect(data.openGraph.image).toBe("https://acme.com/w.png");
    expect(data.canonicalUrl).toBe("https://acme.com/widget");
  });

  it("returns empty structures for a page with no structured data", () => {
    const data = extractPageData(
      makePage({ jsonLdBlocks: [], openGraph: undefined, canonicalUrl: undefined, headings: [] }),
    );
    expect(data).toMatchObject({
      schemaTypes: [],
      organization: null,
      product: null,
      article: null,
      breadcrumbs: [],
      openGraph: {},
      canonicalUrl: null,
      h1: null,
      h2s: [],
    });
  });

  it("survives malformed and deeply nested JSON-LD", () => {
    let deep: Record<string, unknown> = { "@type": "Thing" };
    for (let i = 0; i < 50; i++) deep = { "@type": "Thing", child: deep };
    const data = extractPageData(
      makePage({ jsonLdBlocks: [null, 42, "x", { "@type": 7 }, { offers: "?" }, deep] }),
    );
    expect(data.schemaTypes).toEqual(["Thing"]);
  });
});

describe("pageDataToCsv", () => {
  it("writes a header plus one quoted, injection-safe row per page", () => {
    const data = extractPageData(
      makePage({
        url: "https://acme.com/",
        title: 'Say "hi", world',
        metaDescription: "=HYPERLINK(\"https://evil.test\")",
      }),
    );
    const lines = pageDataToCsv([data]).trimEnd().split("\r\n");
    expect(lines).toHaveLength(2);
    expect(lines[0].startsWith("url,status,title,meta_description,")).toBe(true);
    expect(lines[1]).toContain('"Say ""hi"", world"');
    // A formula from a third-party page is neutralized, not executed.
    expect(lines[1]).toContain(`"'=HYPERLINK(""https://evil.test"")"`);
    expect(lines[0].split(",")).toHaveLength(38);
  });
});
