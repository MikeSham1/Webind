import type { CrawledPage } from "../scoring/types";

/**
 * The Optimization Engine turns a crawled page into ready-to-apply assets the
 * user can copy or download. Everything here is deterministic (generated from
 * crawled data) — no AI/LLM calls. An asset is only produced for a deficiency
 * the report actually found, so the list maps to the fixes.
 */
export interface OptimizationAsset {
  key: string;
  title: string;
  whatItFixes: string;
  language: "html" | "markdown" | "text";
  content: string;
}

export interface OptimizationAssets {
  assets: OptimizationAsset[];
}

function jsonLdTypes(blocks: unknown[]): Set<string> {
  const set = new Set<string>();
  for (const b of blocks) {
    const t = (b as { "@type"?: string | string[] })?.["@type"];
    if (typeof t === "string") set.add(t);
    else if (Array.isArray(t)) t.forEach((x) => set.add(String(x)));
  }
  return set;
}

function originOf(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return url;
  }
}

function siteName(page: CrawledPage): string {
  if (page.title && page.title.trim()) return page.title.trim();
  try {
    return new URL(page.url).hostname.replace(/^www\./, "");
  } catch {
    return page.url;
  }
}

function truncateAtWord(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > 40 ? cut.slice(0, lastSpace) : cut).trim()}…`;
}

function escapeAttr(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Organization + WebSite JSON-LD. Null when both are already present. */
export function schemaAsset(page: CrawledPage): OptimizationAsset | null {
  const types = jsonLdTypes(page.jsonLdBlocks);
  if (types.has("Organization") && types.has("WebSite")) return null;

  const origin = originOf(page.url);
  const name = siteName(page);
  const description = page.metaDescription?.trim() || undefined;
  const jsonld = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        name,
        url: origin,
        ...(description ? { description } : {}),
      },
      { "@type": "WebSite", name, url: origin },
    ],
  };

  return {
    key: "schema",
    title: "Structured data (JSON-LD)",
    whatItFixes:
      "Adds Organization + WebSite schema so AI engines and search can identify your brand. Paste into your page <head>.",
    language: "html",
    content: `<script type="application/ld+json">\n${JSON.stringify(jsonld, null, 2)}\n</script>`,
  };
}

/** Missing <title> and/or <meta description>. Null when both are present. */
export function metaAsset(page: CrawledPage): OptimizationAsset | null {
  const hasTitle = !!page.title?.trim();
  const hasDesc = !!page.metaDescription?.trim();
  if (hasTitle && hasDesc) return null;

  const lines: string[] = [];
  if (!hasTitle) lines.push(`<title>${siteName(page)}</title>`);
  if (!hasDesc) {
    const base =
      page.renderedText?.trim().length > 0
        ? truncateAtWord(page.renderedText, 155)
        : `${siteName(page)} — learn more.`;
    lines.push(`<meta name="description" content="${escapeAttr(base)}">`);
  }

  const missing =
    !hasTitle && !hasDesc
      ? "title tag and meta description"
      : !hasTitle
        ? "title tag"
        : "meta description";

  return {
    key: "meta",
    title: "Meta tags",
    whatItFixes: `Adds the missing ${missing} so search engines can title and summarize your page.`,
    language: "html",
    content: lines.join("\n"),
  };
}

/** llms.txt Markdown summary. Null when the site already serves one. */
export function llmsTxtAsset(page: CrawledPage): OptimizationAsset | null {
  if (page.hasLlmsTxt) return null;

  const name = siteName(page);
  const origin = originOf(page.url);
  const description = page.metaDescription?.trim()
    ? page.metaDescription.trim()
    : page.renderedText?.trim()
      ? truncateAtWord(page.renderedText, 160)
      : `${name}.`;

  const lines = [`# ${name}`, "", `> ${description}`, "", "## Key pages", `- [${name}](${origin})`];

  const topHeadings = page.headings.filter((h) => h.level <= 2 && h.text.trim()).slice(0, 6);
  if (topHeadings.length) {
    lines.push("", "## Topics");
    for (const h of topHeadings) lines.push(`- ${h.text.trim()}`);
  }

  return {
    key: "llmstxt",
    title: "llms.txt",
    whatItFixes:
      "A clean Markdown summary for AI crawlers. Save it as llms.txt at your site root (yourdomain.com/llms.txt).",
    language: "markdown",
    content: lines.join("\n"),
  };
}

/**
 * The AI/answer-engine SEARCH crawlers — the ones that gate whether you can be
 * surfaced or cited. Deliberately excludes training crawlers (GPTBot, ClaudeBot,
 * Google-Extended): blocking those is a legitimate publisher choice about model
 * training that does NOT affect search inclusion, so we never presume to
 * un-block them for the user.
 */
const SEARCH_CRAWLERS: { key: keyof CrawledPage["crawlerAccess"]; ua: string }[] = [
  { key: "googleSearch", ua: "Googlebot" },
  { key: "openaiSearch", ua: "OAI-SearchBot" },
  { key: "anthropicSearch", ua: "Claude-SearchBot" },
  { key: "perplexitySearch", ua: "PerplexityBot" },
];

/** robots.txt lines to unblock the SEARCH crawlers that are actually blocked. */
export function robotsAsset(page: CrawledPage): OptimizationAsset | null {
  const blocked = SEARCH_CRAWLERS.filter((c) => page.crawlerAccess[c.key] === "blocked");
  if (blocked.length === 0) return null;

  const names = blocked.map((c) => c.ua).join(", ");
  return {
    key: "robots",
    title: "robots.txt — allow AI search crawlers",
    whatItFixes:
      `These AI search crawlers are blocked in your robots.txt (${names}), so those ` +
      "engines can't surface or cite you. Add these rules to allow them. Training " +
      "crawlers (GPTBot, ClaudeBot, Google-Extended) are a separate opt-in about model " +
      "training and are intentionally left out — blocking them doesn't affect search.",
    language: "text",
    content: blocked.map((c) => `User-agent: ${c.ua}\nAllow: /`).join("\n\n"),
  };
}

/** Build every applicable optimization asset for a crawled page. */
export function buildOptimizations(page: CrawledPage): OptimizationAssets {
  const assets = [
    schemaAsset(page),
    metaAsset(page),
    llmsTxtAsset(page),
    robotsAsset(page),
  ].filter((a): a is OptimizationAsset => a !== null);
  return { assets };
}
