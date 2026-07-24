"use server";

import { crawl } from "@/lib/crawler/crawl";
import { CrawlerBusyError } from "@/lib/crawler/browser";
import { BlockedUrlError, normalizeUrl } from "@/lib/crawler/ssrf";
import { buildReport } from "@/lib/scoring/report";
import { explainReport } from "@/lib/scoring/explain";
import { buildOptimizations } from "@/lib/optimize/assets";
import { attachEmail, saveReportRequest } from "@/lib/leads";
import type { LeadState, ReportState } from "./report-state";

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
    // `crawl` re-validates the URL and every redirect hop against the SSRF
    // guard; this endpoint is anonymous, so the check cannot live at the edge.
    const page = await crawl(url);
    const report = buildReport(page);
    // Plain-English summary. Uses Claude when ANTHROPIC_API_KEY is set;
    // otherwise falls back to a deterministic, network-free narrative.
    // (Live citation checks are intentionally kept out of the request path.)
    const narrative = await explainReport(report);
    // Deterministic ready-to-apply assets (schema, meta, llms.txt, robots).
    const optimizations = buildOptimizations(page);
    // Best-effort logging (the preview doubles as a lead funnel). Never blocks
    // or breaks the report — returns null when persistence is disabled.
    const requestId = await saveReportRequest(report);
    return { status: "success", report, narrative, optimizations, requestId };
  } catch (err) {
    // These two carry messages written for a visitor; anything else is an
    // internal failure and gets the generic line so we leak nothing.
    if (err instanceof BlockedUrlError || err instanceof CrawlerBusyError) {
      return { status: "error", error: err.message, url };
    }
    return {
      status: "error",
      error:
        "We couldn't reach that site. Check the address is public and try again.",
      url,
    };
  }
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Attach a visitor's email to a logged report run. */
export async function submitLead(
  _prev: LeadState,
  formData: FormData,
): Promise<LeadState> {
  const requestId = String(formData.get("requestId") ?? "");
  const email = String(formData.get("email") ?? "").trim();

  if (!EMAIL_RE.test(email)) {
    return { status: "error", error: "Please enter a valid email address." };
  }
  if (!requestId) {
    return { status: "error", error: "Something went wrong — please refresh." };
  }

  const ok = await attachEmail(requestId, email);
  return ok
    ? { status: "done" }
    : { status: "error", error: "Couldn't save that right now — try again." };
}
