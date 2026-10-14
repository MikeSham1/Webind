/**
 * WebInd crawler CLI: run the crawler and scorer from a terminal, without the
 * web app, a database, a login, or any API key.
 *
 *   npm run crawl -- page https://example.com/pricing
 *   npm run crawl -- site example.com --max-pages 20 --csv data.csv
 *   npm run crawl -- data https://example.com/ --json
 *
 * Built with esbuild and run on plain Node (see package.json "crawl"), not
 * tsx: tsx compiles with keepNames, which injects a `__name` helper into the
 * functions Playwright sends into the page, and they then fail in the browser.
 *
 * Same crawler as the app, same etiquette: robots.txt and Crawl-delay are
 * honored for site scans, requests identify as WebindBot (CRAWLER_USER_AGENT
 * overrides), and private/internal addresses are refused.
 */
import { writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { crawl } from "../../src/lib/crawler/crawl";
import { assessSite, type SiteReport } from "../../src/lib/crawler/assess-site";
import { closeBrowser } from "../../src/lib/crawler/browser";
import { extractPageData, pageDataToCsv, type PageData } from "../../src/lib/crawler/extract-data";
import { normalizeUrl } from "../../src/lib/crawler/ssrf";
import { buildReport } from "../../src/lib/scoring/report";
import type { ReportResult, SignalScore } from "../../src/lib/scoring/types";

const HELP = `WebInd crawler CLI

Usage:
  npm run crawl -- page <url>     Score one page: AI Readiness, Traditional SEO, fixes
  npm run crawl -- site <domain>  Scan a site (sitemap + link following) and score each page
  npm run crawl -- data <url>     Show the structured data one page publishes

Options:
  --json             Print the full result as JSON instead of a summary
  --csv <file>       (site, data) Write the structured data as CSV
  --out <file>       Write the full JSON result to a file
  --max-pages <n>    (site) Pages to scan, 1-50 (default 12)
  --no-follow        (site) Sitemap pages only; don't follow links
  --verbose          Show crawler logs on stderr
  -h, --help         Show this help

Exit codes: 0 success, 1 crawl failed, 2 bad usage.
`;

/** Pages a site scan may cover from the CLI; each one is a full browser crawl. */
const MAX_PAGES_LIMIT = 50;

class UsageError extends Error {}

async function main(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      json: { type: "boolean", default: false },
      csv: { type: "string" },
      out: { type: "string" },
      "max-pages": { type: "string" },
      "no-follow": { type: "boolean", default: false },
      verbose: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  });

  if (values.help || positionals.length === 0) {
    process.stdout.write(HELP);
    return values.help ? 0 : 2;
  }

  // The app's logger writes JSON lines to stdout. Keep stdout for results only:
  // logs go to stderr with --verbose, and are dropped otherwise.
  const toStderr = (...args: unknown[]) => console.error(...args);
  console.log = values.verbose ? toStderr : () => {};
  console.warn = values.verbose ? toStderr : () => {};

  const [command, target, ...extra] = positionals;
  if (!target) throw new UsageError(`"${command}" needs a URL or domain.`);
  if (extra.length > 0) throw new UsageError(`Unexpected argument: ${extra[0]}`);
  const url = normalizeUrl(target);
  if (!url) throw new UsageError(`Not a valid public URL or domain: ${target}`);

  switch (command) {
    case "page": {
      const report = buildReport(await crawl(url));
      writeOut(values.out, report);
      print(values.json ? toJson(report) : formatReport(report));
      return 0;
    }
    case "data": {
      const data = extractPageData(await crawl(url));
      writeOut(values.out, data);
      if (values.csv) writeCsv(values.csv, [data]);
      print(values.json ? toJson(data) : formatData(data));
      return 0;
    }
    case "site": {
      const maxPages = parseMaxPages(values["max-pages"]);
      process.stderr.write(`Scanning ${url} (up to ${maxPages} pages)…\n`);
      const site = await assessSite(url, {
        maxPages,
        followLinks: !values["no-follow"],
      });
      writeOut(values.out, site);
      if (values.csv) {
        writeCsv(values.csv, site.pages.flatMap((p) => (p.data ? [p.data] : [])));
      }
      print(values.json ? toJson(site) : formatSite(site));
      return site.pages.some((p) => p.ok) ? 0 : 1;
    }
    default:
      throw new UsageError(`Unknown command "${command}". Use page, site, or data.`);
  }
}

function parseMaxPages(raw: string | undefined): number {
  if (raw === undefined) return 12;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > MAX_PAGES_LIMIT) {
    throw new UsageError(`--max-pages must be a whole number from 1 to ${MAX_PAGES_LIMIT}.`);
  }
  return n;
}

function print(text: string): void {
  process.stdout.write(text.endsWith("\n") ? text : `${text}\n`);
}

function toJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function writeOut(file: string | undefined, value: unknown): void {
  if (!file) return;
  writeFileSync(file, `${toJson(value)}\n`);
  process.stderr.write(`Wrote ${file}\n`);
}

function writeCsv(file: string, rows: PageData[]): void {
  writeFileSync(file, pageDataToCsv(rows));
  process.stderr.write(`Wrote ${rows.length} row${rows.length === 1 ? "" : "s"} to ${file}\n`);
}

// --- Human-readable output ---------------------------------------------------

function score(n: number | null): string {
  return n === null ? "  —" : String(n).padStart(3);
}

function formatSignals(title: string, total: number, signals: SignalScore[]): string[] {
  const lines = [`${title}: ${total}/100`];
  for (const s of signals) {
    lines.push(`  ${score(s.score)}  ${s.label.padEnd(24)} ${s.reason}`);
  }
  return lines;
}

export function formatReport(r: ReportResult): string {
  const lines = [
    r.url,
    "",
    ...formatSignals("AI Readiness", r.ai.total, r.ai.signals),
    "",
    ...formatSignals("Traditional SEO", r.traditional.total, r.traditional.signals),
  ];
  if (r.prioritizedFixes.length > 0) {
    lines.push("", "Fixes, highest impact first:");
    r.prioritizedFixes.forEach((fix, i) => lines.push(`  ${i + 1}. ${fix}`));
  }
  return lines.join("\n");
}

export function formatData(d: PageData): string {
  const lines = [d.url, ""];
  const row = (label: string, value: string | null | undefined) => {
    if (value) lines.push(`  ${label.padEnd(16)} ${value}`);
  };
  row("Title", d.title);
  row("Description", d.metaDescription);
  row("Canonical", d.canonicalUrl);
  row("H1", d.h1);
  row("Schema types", d.schemaTypes.join(", ") || "none");
  if (d.organization) {
    row("Organization", d.organization.name);
    row("  Logo", d.organization.logo);
    row("  Phone", d.organization.telephone);
    row("  Email", d.organization.email);
    row("  Address", d.organization.address);
    row("  Profiles", d.organization.sameAs.join(", "));
  }
  if (d.product) {
    const price = d.product.price
      ? `${d.product.price} ${d.product.currency ?? ""}`.trim()
      : null;
    row("Product", d.product.name);
    row("  Price", price);
    row("  Availability", d.product.availability);
    row("  Rating", d.product.rating && `${d.product.rating} (${d.product.reviewCount ?? "?"} reviews)`);
  }
  if (d.article) {
    row("Article", d.article.headline);
    row("  Author", d.article.author);
    row("  Published", d.article.datePublished);
  }
  row("Breadcrumbs", d.breadcrumbs.join(" > "));
  const og = Object.keys(d.openGraph);
  row("Open Graph", og.length > 0 ? og.join(", ") : "none");
  return lines.join("\n");
}

export function formatSite(s: SiteReport): string {
  const scored = s.pages.filter((p) => p.ok).length;
  const lines = [
    `${s.origin}: scored ${scored} of ${s.pages.length} pages`,
    `  sitemaps: ${s.sitemaps.length}   via links: ${s.linkDiscovered}   ` +
      `skipped by robots.txt: ${s.blockedByRobots}` +
      (s.crawlDelay !== null ? `   crawl-delay: ${s.crawlDelay}s` : ""),
    ...(s.brokenPages > 0 ? [`  broken pages (HTTP errors): ${s.brokenPages}`] : []),
    ...(s.sitemapHostMismatches > 0
      ? [
          `  sitemap lists ${s.sitemapHostMismatches} URL(s) on the wrong host ` +
            `(should be ${new URL(s.origin).hostname}); scanned them there instead`,
        ]
      : []),
    `  average  AI ${score(s.averageAi)}   Traditional ${score(s.averageTraditional)}`,
    "",
    "   AI  Trad  Page",
  ];
  for (const p of s.pages) {
    let path: string;
    try {
      const u = new URL(p.url);
      path = `${u.pathname}${u.search}`;
    } catch {
      path = p.url;
    }
    const note = p.ok ? (p.source === "link" ? "  (via link)" : "") : `  FAILED: ${p.error}`;
    lines.push(`  ${score(p.ai)}  ${score(p.traditional)}  ${path}${note}`);
  }
  if (s.commonFixes.length > 0) {
    lines.push("", "Fixes that recur across the site:");
    for (const f of s.commonFixes) lines.push(`  ×${f.count}  ${f.fix}`);
  }
  const types = new Map<string, number>();
  for (const p of s.pages) {
    for (const t of p.data?.schemaTypes ?? []) types.set(t, (types.get(t) ?? 0) + 1);
  }
  lines.push(
    "",
    types.size > 0
      ? `Structured data: ${[...types].map(([t, n]) => `${t} ×${n}`).join(", ")}`
      : "Structured data: none found",
  );
  return lines.join("\n");
}

// Only run when executed directly (the formatters are also imported by tests).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(`Error: ${message}\n`);
      if (err instanceof UsageError) process.stderr.write("Run with --help for usage.\n");
      process.exitCode = err instanceof UsageError ? 2 : 1;
    })
    // The shared browser keeps the process alive until it's closed.
    .finally(() => closeBrowser());
}
