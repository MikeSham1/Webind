"use server";

import { crawl } from "@/lib/crawler/crawl";
import { CrawlerBusyError } from "@/lib/crawler/browser";
import { BlockedUrlError, normalizeUrl } from "@/lib/crawler/ssrf";
import { buildReport } from "@/lib/scoring/report";
import { explainReport } from "@/lib/scoring/explain";
import { buildOptimizations } from "@/lib/optimize/assets";
import { attachEmail, getReportForUser, saveReportRequest } from "@/lib/leads";
import { getCurrentUser } from "@/lib/auth";
import {
  getGitHubConnectionStatus,
  getGitHubCredentials,
} from "@/lib/integrations/githubConnections";
import { getPrForReport, recordPrOpened } from "@/lib/integrations/codeFixes";
import { mergeRobotsTxt, openFixPullRequest, type FixFile } from "@/lib/integrations/github";
import { checkRateLimit, formatRetryAfter } from "@/lib/rateLimit";
import { getClientIp } from "@/lib/requestIp";
import { logInfo, logWarn } from "@/lib/log";
import { recordAudit } from "@/lib/audit";
import type { LeadState, PrState, ReportState } from "./report-state";

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

  // Anonymous endpoint, each run launches a real browser and (optionally) a
  // Claude call — cap per-visitor throughput before any of that work starts.
  const ip = await getClientIp();
  const limit = checkRateLimit(`report:${ip}`, 10 * 60 * 1000, 8);
  if (!limit.allowed) {
    return {
      status: "error",
      error: `Too many reports from this connection. ${formatRetryAfter(limit.retryAfterMs)}`,
      url: raw,
    };
  }

  try {
    // `crawl` re-validates the URL and every redirect hop against the SSRF
    // guard; this endpoint is anonymous, so the check cannot live at the edge.
    // The session lookup depends only on cookies, not on the crawl, so it runs
    // alongside it instead of adding its own round-trip to the request.
    const [page, user] = await Promise.all([crawl(url), getCurrentUser()]);
    const report = buildReport(page);
    // Plain-English summary. Uses Claude when ANTHROPIC_API_KEY is set;
    // otherwise falls back to a deterministic, network-free narrative.
    // (Live citation checks are intentionally kept out of the request path.)
    const narrative = await explainReport(report);
    // Deterministic ready-to-apply assets (schema, meta, llms.txt, robots).
    const optimizations = buildOptimizations(page);
    // Best-effort logging (the preview doubles as a lead funnel). Owned by the
    // visitor when they're logged in, anonymous otherwise. Never blocks or
    // breaks the report — returns null when persistence is disabled.
    // `optimizations` is stored too, so a signed-in user's saved report still
    // has its ready-to-apply fixes (and the "open a PR" action) on revisit.
    const requestId = await saveReportRequest(report, user?.id ?? null, optimizations);
    const githubConnected = user
      ? (await getGitHubConnectionStatus(user.id)) !== null
      : false;
    return { status: "success", report, narrative, optimizations, requestId, githubConnected };
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

  const ip = await getClientIp();
  const limit = checkRateLimit(`lead:${ip}`, 60 * 60 * 1000, 20);
  if (!limit.allowed) {
    return { status: "error", error: formatRetryAfter(limit.retryAfterMs) };
  }

  const ok = await attachEmail(requestId, email);
  return ok
    ? { status: "done" }
    : { status: "error", error: "Couldn't save that right now — try again." };
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/**
 * Open a pull request on the report owner's connected GitHub repo, adding or
 * updating llms.txt and robots.txt — the two ready-to-apply assets that are
 * genuinely standalone files (schema/meta are HTML snippets meant for an
 * unknown template, not something safe to commit blindly). A PR already open
 * for this report is reported as-is rather than opened twice.
 *
 * Owner-only — deliberately does NOT use the admin bypass that report-viewing
 * pages use (getReportById). An admin can review any report, but writing to a
 * customer's own GitHub repo is an action only the report's owner can take,
 * even though the destination is always correctly routed to the owner's repo
 * either way. No delegated-publishing path exists yet; an admin who needs to
 * act on a user's behalf has to do it as that user.
 */
export async function openFixPrAction(
  _prev: PrState,
  formData: FormData,
): Promise<PrState> {
  const requestId = String(formData.get("requestId") ?? "");
  if (!requestId) {
    return { status: "error", error: "This report wasn't saved, so there's nothing to open a PR for." };
  }

  const user = await getCurrentUser();
  if (!user) return { status: "error", error: "Log in to open a pull request." };

  const limit = checkRateLimit(`open-pr:${user.id}`, 60 * 60 * 1000, 10);
  if (!limit.allowed) {
    return { status: "error", error: formatRetryAfter(limit.retryAfterMs) };
  }

  const reportRow = await getReportForUser(requestId, user.id);
  if (!reportRow) return { status: "error", error: "Couldn't find that report." };
  if (!reportRow.userId) {
    return { status: "error", error: "This report has no owner to open a PR on behalf of." };
  }

  const existing = await getPrForReport(requestId);
  if (existing) {
    return { status: "opened", prUrl: existing.prUrl, prNumber: existing.prNumber };
  }

  const files: FixFile[] = [];
  for (const asset of reportRow.optimizations?.assets ?? []) {
    if (asset.key === "llmstxt") files.push({ path: "llms.txt", content: asset.content });
    if (asset.key === "robots")
      // Merge into an existing robots.txt rather than overwriting it — never
      // wipe the site's sitemaps or other crawler rules.
      files.push({ path: "robots.txt", content: asset.content, merge: mergeRobotsTxt });
  }
  if (files.length === 0) {
    return {
      status: "error",
      error: "Nothing file-shaped to open a PR for — llms.txt and robots.txt already look good.",
    };
  }

  const creds = await getGitHubCredentials(reportRow.userId);
  if (!creds) return { status: "error", error: "Connect GitHub in Settings before opening a PR." };

  const host = hostOf(reportRow.url);
  const branchName = `webind/ai-crawlability-${requestId.slice(0, 8)}`;
  const result = await openFixPullRequest(creds, files, {
    title: `WeBind: AI crawlability fixes for ${host}`,
    body: [
      `Opened from a WeBind Authority Report for ${reportRow.url}.`,
      "",
      "Adds or updates:",
      ...files.map((f) => `- ${f.path}`),
      "",
      "Review before merging — nothing here is finalized without your approval.",
    ].join("\n"),
    branchName,
  });
  const destination = `${creds.owner}/${creds.repo}`;
  if (!result.ok) {
    logWarn("open_pr.error", { requestId, userId: reportRow.userId, error: result.error });
    await recordAudit({
      actorUserId: user.id,
      action: "github.open_pr",
      destination,
      afterState: { files: files.map((f) => f.path) },
      result: "failure",
      error: result.error,
    });
    return { status: "error", error: result.error };
  }

  const recorded = await recordPrOpened(requestId, reportRow.userId, result);
  await recordAudit({
    actorUserId: user.id,
    action: "github.open_pr",
    destination,
    afterState: { prNumber: result.prNumber, prUrl: result.prUrl, files: files.map((f) => f.path) },
    result: recorded ? "success" : "failure",
    error: recorded ? undefined : "PR opened but failed to save the local record.",
  });
  if (!recorded) {
    logWarn("open_pr.record_failed", {
      requestId,
      userId: reportRow.userId,
      prNumber: result.prNumber,
    });
    return {
      status: "error",
      error: `PR opened, but couldn't save the record. PR: ${result.prUrl}`,
    };
  }

  logInfo("open_pr.ok", { requestId, userId: reportRow.userId, prNumber: result.prNumber });
  return { status: "opened", prUrl: result.prUrl, prNumber: result.prNumber };
}
