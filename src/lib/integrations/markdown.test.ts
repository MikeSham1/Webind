import { describe, expect, it } from "vitest";
import { markdownToHtml, stripLeadingTitle } from "./markdown";

describe("markdownToHtml", () => {
  it("converts headings, paragraphs, lists, rules, and italic spans", () => {
    const md = [
      "# Managed IT",
      "",
      "Acme presents managed it for law firms.",
      "",
      "## Key details",
      "",
      "- 24/7 helpdesk",
      "- SOC 2 certified",
      "",
      "---",
      "",
      "*Disclaimer: not advice.*",
    ].join("\n");

    expect(markdownToHtml(md)).toBe(
      [
        "<h1>Managed IT</h1>",
        "<p>Acme presents managed it for law firms.</p>",
        "<h2>Key details</h2>",
        "<ul><li>24/7 helpdesk</li><li>SOC 2 certified</li></ul>",
        "<hr />",
        "<p><em>Disclaimer: not advice.</em></p>",
      ].join("\n"),
    );
  });

  it("joins consecutive plain lines into one paragraph", () => {
    expect(markdownToHtml("Line one\nLine two")).toBe("<p>Line one Line two</p>");
  });

  it("escapes HTML in user-supplied content (no stored XSS via key facts)", () => {
    const html = markdownToHtml("- <script>alert(1)</script> & \"quoted\"");
    expect(html).toBe(
      "<ul><li>&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;quoted&quot;</li></ul>",
    );
  });
});

describe("stripLeadingTitle", () => {
  it("removes a leading H1 that matches the title", () => {
    expect(stripLeadingTitle("# Managed IT\n\nBody text.", "Managed IT")).toBe(
      "Body text.",
    );
  });

  it("leaves the markdown alone when the first line isn't that title", () => {
    const md = "# Something else\n\nBody text.";
    expect(stripLeadingTitle(md, "Managed IT")).toBe(md);
  });
});
