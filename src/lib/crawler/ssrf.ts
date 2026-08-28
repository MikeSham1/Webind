/**
 * SSRF guard for the crawler.
 *
 * The report endpoint fetches an arbitrary URL supplied by an anonymous
 * visitor, from inside our own network. Without a guard that is a request
 * forgery primitive: `169.254.169.254` reaches cloud instance metadata,
 * `10.x` / `192.168.x` reach internal services, and `127.0.0.1` reaches the app
 * itself. Requiring a dotted hostname does not help — every one of those
 * addresses is dotted.
 *
 * Defence is in two layers, because either alone is insufficient:
 *
 *  1. **Structural** ({@link isBlockedHostname}, {@link isBlockedIp}) — pure,
 *     synchronous, no I/O. Rejects literal private addresses and internal-only
 *     hostname suffixes.
 *  2. **Resolved** ({@link assertPublicUrl}) — resolves the hostname and checks
 *     *every* A/AAAA record, which is what catches names that deliberately
 *     resolve inward (`127.0.0.1.nip.io`, `0x7f.0.0.1`, an attacker-controlled
 *     domain with an internal A record).
 *
 * Both layers must be re-applied on every redirect hop, not just the URL the
 * user typed — a public URL that 302s to `http://169.254.169.254/` defeats an
 * entry-point-only check. See the route interceptor in `crawl.ts`.
 *
 * Known residual risk: DNS rebinding. We validate the addresses a resolver
 * returns, then Chromium performs its own independent lookup, and a hostile
 * authoritative server can return a public address to us and a private one to
 * Chromium. Closing that fully means pinning the validated IP for the actual
 * connection, which Playwright does not expose. The window is narrow and the
 * response body is never echoed back to the visitor, so this is accepted for
 * now and tracked rather than silently ignored.
 */

import { isIP } from "node:net";
import { lookup } from "node:dns/promises";
import {
  RESTRICTED_DOMAIN_ERROR,
  isInternalHostname,
  isRestrictedHostname,
} from "../domainInput";

/** Thrown when a URL is refused. The message is safe to show a visitor. */
export class BlockedUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BlockedUrlError";
  }
}

/** Resolves a hostname to its IP addresses. Injectable so tests stay offline. */
export type HostResolver = (hostname: string) => Promise<string[]>;

const defaultResolver: HostResolver = async (hostname) => {
  const records = await lookup(hostname, { all: true, verbatim: true });
  return records.map((r) => r.address);
};

// --- hostname rules ---------------------------------------------------------

/**
 * Structural hostname check. Returns a human-readable reason when the host must
 * not be fetched, or null when it passes this layer. Passing here is necessary
 * but NOT sufficient — the caller must still resolve and check the addresses.
 */
export function isBlockedHostname(hostname: string): string | null {
  const host = hostname.toLowerCase().replace(/\.$/, "");

  if (!host) return "The address has no hostname.";
  if (isInternalHostname(host)) return "That address is internal-only.";

  // Bracketed IPv6 literal, as URL.hostname reports it.
  const unbracketed = host.startsWith("[") && host.endsWith("]")
    ? host.slice(1, -1)
    : host;

  if (isIP(unbracketed)) {
    return isBlockedIp(unbracketed)
      ? "That address is on a private or reserved network."
      : null;
  }

  // A single-label name (no dot) can only resolve via internal search domains.
  if (!host.includes(".")) return "That doesn't look like a public website.";

  return null;
}

// --- IP rules ---------------------------------------------------------------

/** IPv4 ranges we refuse, as [first octet-packed base, prefix length]. */
const BLOCKED_V4: [string, number][] = [
  ["0.0.0.0", 8], // "this network"
  ["10.0.0.0", 8], // RFC 1918 private
  ["100.64.0.0", 10], // RFC 6598 carrier-grade NAT
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local — includes cloud metadata at .169.254
  ["172.16.0.0", 12], // RFC 1918 private
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.0.2.0", 24], // TEST-NET-1
  ["192.168.0.0", 16], // RFC 1918 private
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24], // TEST-NET-2
  ["203.0.113.0", 24], // TEST-NET-3
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved, includes 255.255.255.255 broadcast
];

function ipv4ToInt(ip: string): number {
  return ip
    .split(".")
    .reduce((acc, octet) => (acc << 8) + Number(octet), 0) >>> 0;
}

function inV4Cidr(ip: number, base: string, bits: number): boolean {
  // A /0 would make the shift undefined; none of our ranges use it.
  const mask = (0xffffffff << (32 - bits)) >>> 0;
  return ((ip & mask) >>> 0) === ((ipv4ToInt(base) & mask) >>> 0);
}

/**
 * True when an IP literal is loopback, private, link-local, or otherwise not a
 * public internet address. Handles IPv4, IPv6, and the IPv4-in-IPv6 forms
 * (`::ffff:127.0.0.1`, NAT64) that would otherwise slip past a v4-only check.
 */
export function isBlockedIp(ip: string): boolean {
  const version = isIP(ip);

  if (version === 4) {
    const value = ipv4ToInt(ip);
    return BLOCKED_V4.some(([base, bits]) => inV4Cidr(value, base, bits));
  }

  if (version !== 6) return true; // not an IP at all — refuse rather than guess

  const addr = ip.toLowerCase();

  // Unwrap embedded IPv4 (::ffff:a.b.c.d, ::ffff:7f00:1, 64:ff9b::a.b.c.d) and
  // re-check it as v4, so a v6 wrapper can't launder a private v4 address.
  const embedded = extractEmbeddedIpv4(addr);
  if (embedded) return isBlockedIp(embedded);

  if (addr === "::" || addr === "::1") return true; // unspecified, loopback
  if (/^f[cd][0-9a-f]{2}:/.test(addr)) return true; // fc00::/7 unique-local
  if (/^fe[89ab][0-9a-f]:/.test(addr)) return true; // fe80::/10 link-local
  if (addr.startsWith("ff")) return true; // ff00::/8 multicast

  return false;
}

/** Pull a dotted-quad or hex-encoded IPv4 address out of an IPv6 literal. */
function extractEmbeddedIpv4(addr: string): string | null {
  const dotted = /:((?:\d{1,3}\.){3}\d{1,3})$/.exec(addr);
  if (dotted && isIP(dotted[1]) === 4) return dotted[1];

  const hexMapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(addr);
  if (hexMapped) {
    const high = parseInt(hexMapped[1], 16);
    const low = parseInt(hexMapped[2], 16);
    return [high >> 8, high & 0xff, low >> 8, low & 0xff].join(".");
  }

  return null;
}

// --- combined check ---------------------------------------------------------

/**
 * Normalize loose user input into a validated public http(s) URL string.
 * Returns null when the value can't be coerced into one. This is the structural
 * layer only; callers that will actually fetch must also await
 * {@link assertPublicUrl}.
 */
export function normalizeUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // Be forgiving: default to https:// when the user omits a scheme.
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;

  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    return null;
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  // Credentials in the URL are a classic way to confuse downstream parsers.
  if (parsed.username || parsed.password) return null;
  if (isBlockedHostname(parsed.hostname) !== null) return null;
  if (isRestrictedHostname(parsed.hostname)) return null;

  return parsed.toString();
}

/**
 * Full check: structural rules plus every address the hostname resolves to.
 * Throws {@link BlockedUrlError} with a visitor-safe message when refused.
 */
export async function assertPublicUrl(
  rawUrl: string,
  resolver: HostResolver = defaultResolver,
): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new BlockedUrlError("That doesn't look like a valid web address.");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new BlockedUrlError("Only http and https addresses can be analyzed.");
  }

  if (isRestrictedHostname(parsed.hostname)) {
    throw new BlockedUrlError(RESTRICTED_DOMAIN_ERROR);
  }

  const structural = isBlockedHostname(parsed.hostname);
  if (structural !== null) throw new BlockedUrlError(structural);

  // An IP literal has already been fully checked above; no lookup to do.
  const bare = parsed.hostname.replace(/^\[|\]$/g, "");
  if (isIP(bare)) return;

  let addresses: string[];
  try {
    addresses = await resolver(parsed.hostname);
  } catch {
    throw new BlockedUrlError("We couldn't resolve that domain.");
  }

  if (addresses.length === 0) {
    throw new BlockedUrlError("We couldn't resolve that domain.");
  }

  // Every record must be public: one private answer is enough to abuse.
  if (addresses.some(isBlockedIp)) {
    throw new BlockedUrlError(
      "That domain resolves to a private or reserved network address.",
    );
  }
}

/** Convenience predicate for hot paths that just need a yes/no. */
export async function isPublicUrl(
  rawUrl: string,
  resolver: HostResolver = defaultResolver,
): Promise<boolean> {
  try {
    await assertPublicUrl(rawUrl, resolver);
    return true;
  } catch {
    return false;
  }
}
