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
