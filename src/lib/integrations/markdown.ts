/**
 * Convert a Content Studio draft's markdown to HTML for WordPress.
 *
 * Uses `marked` (full CommonMark) rather than a hand-rolled converter: the
 * previous version only understood the narrow grammar the deterministic
 * template assembler emitted (`#`/`##` headings, `- ` lists, `---` rules,
 * `*italic*`) — real Markdown constructs an LLM writer produces routinely
 * (`**bold**`, `### ` H3s, `[text](url)` links) were left as literal,
 * unrendered text on the published page.
 *
 * `marked` does not escape or strip raw HTML embedded in its input — that's
 * standard Markdown behavior, and exactly the shape of a stored-XSS risk
 * here: a key fact or brand name is user-supplied and flows into this
 * markdown unescaped. `sanitize-html` is the second, mandatory pass that
 * actually closes that: an explicit tag/attribute allowlist strips anything
 * else regardless of whether it arrived as raw HTML in the source or via
 * some Markdown construct, so the security property the old escaper
 * provided is preserved even though the parser itself doesn't provide it.
 */

import { marked } from "marked";
import sanitizeHtml from "sanitize-html";

marked.setOptions({ gfm: true, breaks: false });

const ALLOWED_TAGS = [
  "p", "br", "hr",
  "h1", "h2", "h3", "h4",
  "ul", "ol", "li",
  "strong", "em", "a",
  "blockquote", "code", "pre",
];

const ALLOWED_ATTRIBUTES: sanitizeHtml.IOptions["allowedAttributes"] = {
  a: ["href", "title", "rel"],
};

export function markdownToHtml(markdown: string): string {
  const rawHtml = marked.parse(markdown, { async: false });
  return sanitizeHtml(rawHtml, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: ALLOWED_ATTRIBUTES,
    // http(s) only — a javascript: or data: href in a link is a live XSS
    // vector the moment someone clicks it on the published page.
    allowedSchemes: ["http", "https", "mailto"],
    // Marked emits target/rel-free links; WordPress's own editor adds
    // rel="noopener" for external links, but we're bypassing that editor —
    // add it here so a link a reviewer approved can't tab-nab the original page.
    transformTags: {
      a: sanitizeHtml.simpleTransform("a", { rel: "noopener noreferrer" }),
    },
  });
}

/**
 * Strip a single leading `# Title` line matching `title` (case-insensitive).
 * WordPress renders the page title from its own title field, so the draft's
 * own H1 — generated to match `title` exactly — would otherwise duplicate it.
 */
export function stripLeadingTitle(markdown: string, title: string): string {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  if (lines[0]?.trim().toLowerCase() === `# ${title}`.toLowerCase()) {
    return lines.slice(1).join("\n").replace(/^\n+/, "");
  }
  return markdown;
}
