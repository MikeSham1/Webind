/** Shared validation and content-safety rules for user-supplied domains. */

export const DOMAIN_INPUT_ERROR =
  "Enter only a domain, like example.com. Don't include https://, a path, a port, or other text.";

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
  const labels = domain.split(".");
  const validLabels = labels.every(
    (label) =>
      label.length > 0 &&
      label.length <= 63 &&
      /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label),
  );
  const tld = labels.at(-1) ?? "";

  if (
    labels.length < 2 ||
    !validLabels ||
    !/[a-z]/i.test(tld) ||
    isInternalHostname(domain)
  ) {
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
