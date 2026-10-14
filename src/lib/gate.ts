/**
 * Pre-launch password gate.
 *
 * The whole site sits behind a single shared password (see middleware.ts).
 * On success we store an HMAC token in an httpOnly cookie rather than the
 * password itself; the token can only be produced by someone who knows the
 * password, so a stolen cookie still doesn't reveal it. Uses Web Crypto so the
 * same code runs in both the Edge middleware and Node route handlers.
 */

const encoder = new TextEncoder();
const MESSAGE = "webind-preview-authed-v1";

/** Name of the cookie holding the gate token. */
export const GATE_COOKIE = "wb_gate";

/** The configured site password, or null when unset (fail closed). */
export function sitePassword(): string | null {
  const p = process.env.SITE_PASSWORD;
  return p && p.length > 0 ? p : null;
}

/**
 * Whether the site is deliberately public. Unsetting SITE_PASSWORD alone does
 * NOT open the site — proxy.ts fails closed with no password configured — so
 * going live needs this explicit, separate flag instead of an absence being
 * silently read as "public". Also the single switch that flips indexing (see
 * next.config.ts, robots.ts, sitemap.ts, and the root layout's metadata) so
 * there's one flag to set at launch, not several files to remember to edit.
 */
export function isPublicLaunch(): boolean {
  return process.env.SITE_PUBLIC === "true";
}

async function hmacHex(key: string, msg: string): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(msg));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Derive the cookie token for a password. Only derivable with the password. */
export function gateToken(password: string): Promise<string> {
  return hmacHex(password, MESSAGE);
}

/** Length-safe string comparison (avoids leaking length via early exit). */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

/**
 * Cookie to seed into the crawler's browser context so a self-scan of our own
 * deployment (someone running an AI Readiness Report or Fix Generator against
 * this very site while it's still gated) sees the real page instead of being
 * redirected to /splash and silently scoring that instead.
 *
 * Only activates when APP_BASE_URL is explicitly configured, and only for a
 * target whose origin matches it exactly — deliberately NOT compared against
 * header-derived origins (x-forwarded-host/proto, as getBaseUrl() uses for
 * non-security-sensitive links). Those headers are attacker-controlled unless
 * a fronting proxy strips and re-sets them, and the target URL here is
 * attacker-controlled too (it's whatever the anonymous report form was given)
 * — trusting a spoofable "this is our own origin" signal would let someone
 * trick the server into sending this proof-of-password cookie to a URL they
 * chose. An explicit operator-configured value has no such spoofing surface.
 */
export async function selfScanGateCookie(
  targetUrl: string,
): Promise<{ name: string; value: string; url: string } | null> {
  if (isPublicLaunch()) return null;

  const password = sitePassword();
  if (!password) return null;

  const configuredBase = process.env.APP_BASE_URL?.trim();
  if (!configuredBase) return null;

  let targetOrigin: string;
  let selfOrigin: string;
  try {
    targetOrigin = new URL(targetUrl).origin;
    selfOrigin = new URL(configuredBase).origin;
  } catch {
    return null;
  }
  if (targetOrigin !== selfOrigin) return null;

  return { name: GATE_COOKIE, value: await gateToken(password), url: selfOrigin };
}
