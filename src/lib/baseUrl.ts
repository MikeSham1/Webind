import { headers } from "next/headers";

/**
 * Best-effort absolute origin of the current deployment, for building links
 * that go into emails (which have no browser URL bar to be relative to).
 * Derived from the request's own forwarded host/proto rather than a hardcoded
 * env var, so it's automatically correct across preview/staging/prod without
 * needing to keep a domain in sync in two places.
 */
export async function getBaseUrl(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto =
    h.get("x-forwarded-proto") ?? (process.env.NODE_ENV === "production" ? "https" : "http");
  if (host) return `${proto}://${host}`;
  return process.env.APP_BASE_URL?.trim() || "http://localhost:3000";
}
