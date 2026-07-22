"use server";

import { crawl } from "@/lib/crawler/crawl";
import { buildReport } from "@/lib/scoring/report";
import { explainReport } from "@/lib/scoring/explain";
import type { ReportResult } from "@/lib/scoring/types";

/** Result of a report run, shaped for `useActionState`. */
export type ReportState =
  | { status: "idle" }
  | { status: "success"; report: ReportResult; narrative: string }
  | { status: "error"; error: string; url: string };

export const initialReportState: ReportState = { status: "idle" };

/**
 * Normalize loose user input into a validated http(s) URL string.
 * Returns null when the value can't be coerced into a safe web URL.
 */
function normalizeUrl(raw: string): string | null {
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
  // Require a dotted hostname so bare words / internal names are rejected early.
  if (!parsed.hostname.includes(".")) return null;

  return parsed.toString();
}

/**
 * Server action: crawl the given URL and build its authority report.
 *
 * Runs in the Node.js runtime (Playwright requires it — see `runtime` on the
 * page). Never throws to the client: invalid input and crawl failures are
 * returned as a friendly `error` state.
 */
export async function runReport(
  _prev: ReportState,
  formData: FormData,
): Promise<ReportState> {
  const raw = String(formData.get("url") ?? "");
  const url = normalizeUrl(raw);

  if (!url) {
    return {
      status: "error",
      error:
        "That doesn't look like a valid website address. Try something like example.com.",
      url: raw,
    };
  }

  try {
    // TODO: SSRF hardening (block internal IPs) before public launch.
    const page = await crawl(url);
    const report = buildReport(page);
    // Plain-English summary. Uses Claude when ANTHROPIC_API_KEY is set;
    // otherwise falls back to a deterministic, network-free narrative.
    // (Live citation checks are intentionally kept out of the request path.)
    const narrative = await explainReport(report);
    return { status: "success", report, narrative };
  } catch {
    return {
      status: "error",
      error:
        "We couldn't reach that site. Check the address is public and try again.",
      url,
    };
  }
}
