/**
 * Convert a Content Studio draft's markdown to HTML for WordPress.
 *
 * Deliberately not a general-purpose parser: `assembleDraft()` and the YMYL
 * disclaimer only ever emit `#`/`##` headings, `- ` list items, `---` rules,
 * `*italic*` spans, and plain paragraphs, so that's the entire grammar here.
 * A key fact or brand name is user-supplied and lands in this markdown
 * unescaped, so every span of literal text is HTML-escaped before it's
 * emitted — this is what stands between that and a stored-XSS payload on the
 * customer's own WordPress site.
 */

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Escape, then apply the one supported inline span: `*italic*`. */
function inline(text: string): string {
  return escapeHtml(text).replace(/\*(.+?)\*/g, "<em>$1</em>");
}

export function markdownToHtml(markdown: string): string {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const html: string[] = [];
  let paragraph: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length) {
      html.push(`<p>${inline(paragraph.join(" "))}</p>`);
      paragraph = [];
    }
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i].trim();

    if (line === "") {
      flushParagraph();
      i++;
      continue;
    }
    if (line === "---") {
      flushParagraph();
      html.push("<hr />");
      i++;
      continue;
    }
    const h1 = /^#\s+(.*)$/.exec(line);
    if (h1) {
      flushParagraph();
      html.push(`<h1>${inline(h1[1])}</h1>`);
      i++;
      continue;
    }
    const h2 = /^##\s+(.*)$/.exec(line);
    if (h2) {
      flushParagraph();
      html.push(`<h2>${inline(h2[1])}</h2>`);
      i++;
      continue;
    }
    if (/^-\s+/.test(line)) {
      flushParagraph();
      const items: string[] = [];
      while (i < lines.length && /^-\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^-\s+/, ""));
        i++;
      }
      html.push(`<ul>${items.map((item) => `<li>${inline(item)}</li>`).join("")}</ul>`);
      continue;
    }

    paragraph.push(line);
    i++;
  }
  flushParagraph();

  return html.join("\n");
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
