import { headers } from "next/headers";

/**
 * Absolute origin of the current deployment, for building links that go into
 * emails and Stripe checkout/portal redirects (which have no browser URL bar
 * to be relative to, and in the email case are trusted purely on the strength
 * of this function's output).
 *
 * APP_BASE_URL — an explicit, operator-configured value — is checked FIRST
 * and wins whenever it's set. This used to check the request's forwarded
 * host/proto headers first and only fall back to APP_BASE_URL if neither was
 * present: those headers are attacker-controlled unless a fronting proxy
 * strips and re-sets them, which isn't something this code can verify, and
 * this function's output lands directly in password-reset and email-
 * verification links — a spoofed Host header there is a password-reset
 * poisoning primitive, not just a cosmetic bug. Header-derived detection
 * remains the fallback for environments with no fixed domain (local dev,
 * preview deploys), where there's no static value to configure anyway.
 */
export async function getBaseUrl(): Promise<string> {
  const configured = process.env.APP_BASE_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");

  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto =
    h.get("x-forwarded-proto") ?? (process.env.NODE_ENV === "production" ? "https" : "http");
  return host ? `${proto}://${host}` : "http://localhost:3000";
}
