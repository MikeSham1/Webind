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
    const html = markdownToHtml(md);

    expect(html).toContain("<h1>Managed IT</h1>");
    expect(html).toContain("<p>Acme presents managed it for law firms.</p>");
    expect(html).toContain("<h2>Key details</h2>");
    expect(html).toContain("<li>24/7 helpdesk</li>");
    expect(html).toContain("<li>SOC 2 certified</li>");
    expect(html).toContain("<hr");
    expect(html).toContain("<em>Disclaimer: not advice.</em>");
  });

  it("joins consecutive plain lines into one paragraph", () => {
    expect(markdownToHtml("Line one\nLine two")).toBe("<p>Line one\nLine two</p>\n");
  });

  // The previous hand-rolled converter only understood a narrow grammar
  // (h1/h2, lists, italic) written for the deterministic template — an LLM
  // writer routinely produces bold, H3s, and links, which used to reach
  // WordPress as literal, unrendered `**`/`###`/`[]()` text.
  it("renders bold text, H3 headings, and links — the previous converter left these as literal text", () => {
    const md = "### A subheading\n\nSome **bold** text and a [link](https://example.com/page).";
    const html = markdownToHtml(md);

    expect(html).toContain("<h3>A subheading</h3>");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain('<a href="https://example.com/page"');
    expect(html).not.toContain("###");
    expect(html).not.toContain("**");
    expect(html).not.toContain("[link]");
  });

  it("adds rel=noopener noreferrer to links, since WordPress's own editor isn't in the loop to do it", () => {
    const html = markdownToHtml("[external](https://example.com)");
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it("strips a script tag entirely, including its content — no stored XSS via key facts", () => {
    const html = markdownToHtml("- <script>alert(document.cookie)</script> normal text");
    expect(html).not.toContain("<script");
    expect(html).not.toContain("alert(document.cookie)");
    expect(html).toContain("normal text");
  });

  it("strips a javascript: URL scheme from a link", () => {
    const html = markdownToHtml("[click me](javascript:alert(1))");
    expect(html).not.toContain("javascript:");
  });

  it("strips disallowed tags like img and iframe (not part of this content model)", () => {
    const html = markdownToHtml('<img src=x onerror=alert(1)>\n\n<iframe src="https://evil.example"></iframe>');
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<iframe");
    expect(html).not.toContain("onerror");
  });

  it("HTML-escapes literal angle brackets and ampersands in plain text", () => {
    const html = markdownToHtml("Widgets & Gadgets < 5 minutes away");
    expect(html).toContain("Widgets &amp; Gadgets &lt; 5 minutes away");
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
