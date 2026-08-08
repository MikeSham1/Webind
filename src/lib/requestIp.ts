import { headers } from "next/headers";

/**
 * Best-effort client IP for rate limiting, from the proxy headers Railway (or
 * any reverse proxy) sets. `x-forwarded-for`'s first entry is the original
 * client; later entries are appended by each hop, so trusting anything past
 * the first would let a client simply prepend a fake header of its own to
 * evade limits. Falls back to a fixed key when neither header is present
 * (e.g. local dev without a proxy) — rate limiting degrades to "shared across
 * all anonymous traffic" rather than silently doing nothing.
 */
export async function getClientIp(): Promise<string> {
  const h = await headers();
  const forwarded = h.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  const real = h.get("x-real-ip");
  if (real) return real;
  return "unknown";
}
