"use server";

import { assessSite } from "@/lib/crawler/assess-site";
import { parseDomainInput } from "@/lib/domainInput";
import { checkRateLimit, formatRetryAfter } from "@/lib/rateLimit";
import { getClientIp } from "@/lib/requestIp";
import { logInfo, logWarn } from "@/lib/log";
import type { SiteReportState } from "./state";

/** Pages assessed per run — a site scan is many crawls, so keep it bounded. */
const MAX_PAGES = 12;

/**
 * Server action: discover a site's sitemap and assess every page it lists.
 *
 * Node.js runtime (Playwright). Never throws to the client. Rate-limited hard,
 * because one run fans out into up to {@link MAX_PAGES} full browser crawls.
 */
export async function runSiteReport(
  _prev: SiteReportState,
  formData: FormData,
): Promise<SiteReportState> {
  const raw = String(formData.get("site") ?? "");
  // A site scan starts from the domain, not a single page.
  const parsed = parseDomainInput(raw);
  if (!parsed.ok) {
    return { status: "error", error: parsed.error, input: raw };
  }

  // Far tighter than the single-page report: each run is up to MAX_PAGES crawls.
  const ip = await getClientIp();
  const limit = checkRateLimit(`site-report:${ip}`, 15 * 60 * 1000, 2);
  if (!limit.allowed) {
    return {
      status: "error",
      error: `Too many site scans from this connection. ${formatRetryAfter(limit.retryAfterMs)}`,
      input: raw,
    };
  }

  try {
    const report = await assessSite(parsed.url, { maxPages: MAX_PAGES });
    logInfo("site_report.ok", {
      origin: report.origin,
      pages: report.pages.length,
      scored: report.pages.filter((p) => p.ok).length,
    });
    return { status: "success", report };
  } catch (err) {
    // assessSite is designed never to throw (per-page failures are recorded in
    // the report, not raised); this catch is a defensive backstop only.
    logWarn("site_report.error", {
      input: raw,
      error: err instanceof Error ? err.message : String(err),
    });
    return {
      status: "error",
      error: "We couldn't scan that site. Check the address is public and try again.",
      input: raw,
    };
  }
}
