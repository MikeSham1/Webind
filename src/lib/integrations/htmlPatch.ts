/**
 * Patch a static HTML page's <head> for a WeBind pull request.
 *
 * Schema and meta tags belong inside the page itself, which for most stacks
 * means an unknown template WeBind can't safely edit. A plain static HTML
 * site is the exception: the page IS a file in the repo. So for those, the PR
 * edits the file directly; everything else keeps the copy-paste snippets.
 *
 * Every change is conservative, and the PR review is the owner's consent:
 * - only an existing file with a real </head> is touched; nothing is created;
 * - WeBind's additions sit between marker comments, so a re-run replaces its
 *   own block instead of stacking duplicates, and a reader can see exactly
 *   what was added (and delete it cleanly);
 * - a tag the owner already wrote (a title, a meta description) is never
 *   added a second time or overwritten.
 */

/** Folders a static site commonly serves pages from (repo root first). */
const SITE_ROOTS = ["", "public/", "docs/"];

/**
 * Repo paths that could hold the page at `pageUrl`, most likely first:
 * "/" → index.html; "/shop.html" → shop.html; "/about/" → about/index.html;
 * "/about" → about.html or about/index.html. Each under the root, public/ and
 * docs/. Empty when the URL can't map to a static file (unparseable, or a
 * path with a non-HTML extension).
 */
export function htmlFileCandidates(pageUrl: string): string[] {
  let path: string;
  try {
    path = decodeURIComponent(new URL(pageUrl).pathname);
  } catch {
    return [];
  }
  // Path traversal can't reach outside the repo through the contents API,
  // but there's no legitimate page path containing "..", so refuse it.
  if (path.split("/").includes("..")) return [];

  const rel = path.replace(/^\/+/, "");
  let names: string[];
  if (rel === "" || rel.endsWith("/")) {
    names = [`${rel}index.html`];
  } else if (/\.html?$/i.test(rel)) {
    names = [rel];
  } else if (/\.[a-z0-9]+$/i.test(rel.split("/").pop() ?? "")) {
    return []; // .php, .aspx, …: a server template, not a static page
  } else {
    names = [`${rel}.html`, `${rel}/index.html`];
  }
  return SITE_ROOTS.flatMap((root) => names.map((n) => `${root}${n}`));
}

const MARKER = (id: string, edge: "start" | "end") => `<!-- WeBind:${id}:${edge} -->`;

/**
 * Put `snippet` in the document head, inside a WeBind marker block named `id`.
 * Replaces the block if a previous run added one; otherwise inserts it just
 * before </head>. Returns null when the file has no </head> to anchor on.
 */
export function upsertHeadBlock(html: string, id: string, snippet: string): string | null {
  const start = MARKER(id, "start");
  const end = MARKER(id, "end");
  const block = `${start}\n${snippet.trim()}\n${end}`;
  const indentBlock = (indent: string) =>
    block
      .split("\n")
      .map((line, i) => (i === 0 || !line ? line : indent + line))
      .join("\n");
  /** The whitespace between the start of `index`'s line and `index`. */
  const indentAt = (index: number) => {
    const lineStart = html.lastIndexOf("\n", index - 1) + 1;
    return /^[ \t]*/.exec(html.slice(lineStart, index))?.[0] ?? "";
  };

  const s = html.indexOf(start);
  const e = html.indexOf(end);
  if (s !== -1 && e > s) {
    // Keep the block where and how it was, so an unchanged re-run is a no-op.
    return html.slice(0, s) + indentBlock(indentAt(s)) + html.slice(e + end.length);
  }

  const close = html.search(/<\/head\s*>/i);
  if (close === -1) return null;
  // Match the indentation of the line </head> sits on, plus one level.
  const indent = indentAt(close);
  const inner = `${indent}  `;
  return `${html.slice(0, close).trimEnd()}\n${inner}${indentBlock(inner)}\n${indent}${html.slice(close)}`;
}

/** Whether the file already has a <title> with text in it. */
function hasTitle(html: string): boolean {
  return /<title[^>]*>\s*\S[\s\S]*?<\/title>/i.test(html);
}

/** Whether the file already has a meta description (any attribute order). */
function hasMetaDescription(html: string): boolean {
  return /<meta\b[^>]*\bname\s*=\s*["']?description["']?[^>]*>/i.test(html);
}

/**
 * Keep only the tags from a meta snippet that the file doesn't already have,
 * so an owner's own title or description is never duplicated.
 */
export function missingMetaTags(html: string, metaSnippet: string): string {
  return metaSnippet
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => {
      if (/^<title/i.test(line)) return !hasTitle(html);
      if (/^<meta\b[^>]*name="description"/i.test(line)) return !hasMetaDescription(html);
      return line.length > 0;
    })
    .join("\n");
}

export interface HeadPatches {
  /** A <script type="application/ld+json"> block, when schema is missing. */
  schema?: string;
  /** <title>/<meta name="description"> lines, when either is missing. */
  meta?: string;
}

/**
 * Apply WeBind's head patches to one HTML file. Returns the new HTML, or null
 * when the file can't be patched safely (no </head>) or nothing would change.
 */
export function patchHtmlHead(html: string, patches: HeadPatches): string | null {
  let out = html;
  if (patches.schema) {
    const next = upsertHeadBlock(out, "schema", patches.schema);
    if (next === null) return null;
    out = next;
  }
  if (patches.meta) {
    const tags = missingMetaTags(out, patches.meta);
    if (tags) {
      const next = upsertHeadBlock(out, "meta", tags);
      if (next === null) return null;
      out = next;
    }
  }
  return out === html ? null : out;
}
