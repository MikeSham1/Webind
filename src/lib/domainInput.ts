/** Shared validation and content-safety rules for user-supplied domains. */

export const DOMAIN_INPUT_ERROR =
  "Enter only a domain, like example.com. Don't include https://, a path, a port, or other text.";

export const PAGE_INPUT_ERROR =
  "Enter a domain or page, like example.com or example.com/blog/post. Don't include https:// or a port.";

export const RESTRICTED_DOMAIN_ERROR =
  "Webind doesn't analyze adult-content websites.";

export type DomainInputResult =
  | { ok: true; domain: string; url: string }
  | { ok: false; error: string; reason: "invalid" | "restricted" };

const INTERNAL_SUFFIXES = [
  ".localhost",
  ".local",
  ".internal",
  ".intranet",
  ".home.arpa",
];

const INTERNAL_HOSTNAMES = new Set([
  "localhost",
  "metadata.google.internal",
  "metadata",
]);

const RESTRICTED_TLDS = new Set(["adult", "porn", "sex", "xxx"]);

// High-confidence adult platforms whose names do not always contain a useful
// category marker. Subdomains are covered by suffix matching too.
const RESTRICTED_DOMAIN_SUFFIXES = [
  "adultfriendfinder.com",
  "brazzers.com",
  "cam4.com",
  "chaturbate.com",
  "clips4sale.com",
  "fansly.com",
  "livejasmin.com",
  "manyvids.com",
  "onlyfans.com",
  "pornhub.com",
  "redtube.com",
  "spankbang.com",
  "stripchat.com",
  "tube8.com",
  "xhamster.com",
  "xnxx.com",
  "xvideos.com",
  "youporn.com",
];

const RESTRICTED_EXACT_LABELS = new Set([
  "adult",
  "adults",
  "erotic",
  "erotica",
  "nsfw",
  "porno",
  "sex",
  "xxx",
]);

const RESTRICTED_LABEL_FRAGMENTS = [
  "camgirl",
  "hentai",
  "porn",
  "rule34",
  "sexcam",
];

function cleanHostname(hostname: string): string {
  return hostname.toLowerCase().replace(/\.$/, "");
}

/**
 * Canonical host for a URL or bare domain: lowercase, no `www.`, no port/path.
 * Returns null when there's no usable host, so callers never store or compare
 * against junk. Pure — this is the identity rule that makes acme.com,
 * www.acme.com and https://Acme.com/pricing the same site, and it must be the
 * ONE place that decision is made: anywhere a host from a stored URL is
 * compared against a host from user input needs both sides run through this,
 * or a www/case mismatch makes an otherwise-identical site look unrelated.
 */
export function canonicalHost(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let host: string;
  try {
    host = new URL(withScheme).hostname;
  } catch {
    return null;
  }
  const clean = cleanHostname(host).replace(/^www\./, "");
  // Require a dotted name so "localhost" or a stray word never becomes a site.
  return clean.includes(".") ? clean : null;
}

export function isInternalHostname(hostname: string): boolean {
  const host = cleanHostname(hostname);
  return (
    INTERNAL_HOSTNAMES.has(host) ||
    INTERNAL_SUFFIXES.some((suffix) => host.endsWith(suffix))
  );
}

/** A conservative, deterministic pre-fetch adult-domain filter. */
export function isRestrictedHostname(hostname: string): boolean {
  const host = cleanHostname(hostname);
  const labels = host.split(".");
  const tld = labels.at(-1) ?? "";

  if (RESTRICTED_TLDS.has(tld)) return true;
  if (
    RESTRICTED_DOMAIN_SUFFIXES.some(
      (suffix) => host === suffix || host.endsWith(`.${suffix}`),
    )
  ) {
    return true;
  }

  return labels.some(
    (label) =>
      RESTRICTED_EXACT_LABELS.has(label) ||
      RESTRICTED_LABEL_FRAGMENTS.some((fragment) => label.includes(fragment)),
  );
}

/** Shared host validation: 2+ DNS-valid labels, a lettered TLD, not internal. */
function hostIsValid(domain: string): boolean {
  const labels = domain.split(".");
  const tld = labels.at(-1) ?? "";
  return (
    labels.length >= 2 &&
    /[a-z]/i.test(tld) &&
    !isInternalHostname(domain) &&
    labels.every(
      (label) =>
        label.length > 0 &&
        label.length <= 63 &&
        /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label),
    )
  );
}

/**
 * Parse a form value that may be a bare domain OR a specific page path
 * (example.com/blog/post), but never a full URL with a scheme or a port. Used
 * by the page-level Report so a specific article/product page can be analyzed —
 * the SSRF guard in the crawler still re-validates the resulting URL. Benchmark
 * and Keyword Visibility use {@link parseDomainInput} (domain only) instead.
 */
export function parsePageInput(raw: string): DomainInputResult {
  const input = raw.trim();
  // The field supplies the scheme, so a typed scheme is a mistake; reject
  // whitespace and embedded credentials too. Paths/queries ARE allowed.
  if (
    !input ||
    input.length > 2000 ||
    /^[a-z][a-z0-9+.-]*:\/\//i.test(input) ||
    /[\s@\\]/.test(input)
  ) {
    return { ok: false, error: PAGE_INPUT_ERROR, reason: "invalid" };
  }

  let parsed: URL;
  try {
    parsed = new URL(`https://${input}`);
  } catch {
    return { ok: false, error: PAGE_INPUT_ERROR, reason: "invalid" };
  }
  if (parsed.port || parsed.username || parsed.password) {
    return { ok: false, error: PAGE_INPUT_ERROR, reason: "invalid" };
  }

  const domain = cleanHostname(parsed.hostname);
  if (!hostIsValid(domain)) {
    return { ok: false, error: PAGE_INPUT_ERROR, reason: "invalid" };
  }
  if (isRestrictedHostname(domain)) {
    return { ok: false, error: RESTRICTED_DOMAIN_ERROR, reason: "restricted" };
  }

  // Preserve the path + query the user asked to analyze; drop the fragment.
  return { ok: true, domain, url: `https://${domain}${parsed.pathname}${parsed.search}` };
}

/**
 * Parse a form value that must be a bare public domain, never a URL.
 * Successful values are canonicalized to an HTTPS origin for the crawler.
 */
export function parseDomainInput(raw: string): DomainInputResult {
  const input = raw.trim();
  if (
    !input ||
    input.length > 253 ||
    input.endsWith(".") ||
    /[\s/:?#@\\]/.test(input)
  ) {
    return { ok: false, error: DOMAIN_INPUT_ERROR, reason: "invalid" };
  }

  let parsed: URL;
  try {
    parsed = new URL(`https://${input}`);
  } catch {
    return { ok: false, error: DOMAIN_INPUT_ERROR, reason: "invalid" };
  }

  const domain = cleanHostname(parsed.hostname);
  if (!hostIsValid(domain)) {
    return { ok: false, error: DOMAIN_INPUT_ERROR, reason: "invalid" };
  }

  if (isRestrictedHostname(domain)) {
    return {
      ok: false,
      error: RESTRICTED_DOMAIN_ERROR,
      reason: "restricted",
    };
  }

  return { ok: true, domain, url: `https://${domain}/` };
}
