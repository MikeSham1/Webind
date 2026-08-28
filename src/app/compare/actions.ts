"use server";

import { crawl } from "@/lib/crawler/crawl";
import { CrawlerBusyError } from "@/lib/crawler/browser";
import { BlockedUrlError } from "@/lib/crawler/ssrf";
import { parseDomainInput } from "@/lib/domainInput";
import { buildReport } from "@/lib/scoring/report";
import { checkRateLimit, formatRetryAfter } from "@/lib/rateLimit";
import { getClientIp } from "@/lib/requestIp";
import type { CompareSide, CompareState } from "./compare-state";

/** Crawl + score one side. Never throws — same error shape as runReport. */
async function runSide(url: string): Promise<CompareSide> {
  try {
    const page = await crawl(url);
    const report = buildReport(page);
    return { status: "ok", report };
  } catch (err) {
    if (err instanceof BlockedUrlError || err instanceof CrawlerBusyError) {
      return { status: "error", error: err.message, url };
    }
    return {
      status: "error",
      error: "We couldn't reach that site. Check the address is public and try again.",
      url,
    };
  }
}

/**
 * Server action: crawl and score two URLs side by side. Deliberately skips
 * the narrative/optimizations/save-to-DB steps runReport does — comparison
 * is about the two scores and signal breakdowns, not a saved, revisitable
 * report — so it stays lighter than running the full pipeline twice.
 *
 * Each side is independent (Promise.all, not a combined try/catch): one
 * unreachable site shouldn't block seeing the other one's scores.
 */
export async function runCompareAction(
  _prev: CompareState,
  formData: FormData,
): Promise<CompareState> {
  const rawA = String(formData.get("urlA") ?? "");
  const rawB = String(formData.get("urlB") ?? "");
  if (!rawA.trim() || !rawB.trim()) {
    return { status: "error", error: "Enter two domains to compare." };
  }

  const inputA = parseDomainInput(rawA);
  if (!inputA.ok) {
    return { status: "error", error: `Your site: ${inputA.error}` };
  }
  const inputB = parseDomainInput(rawB);
  if (!inputB.ok) {
    return { status: "error", error: `Competitor: ${inputB.error}` };
  }

  // Anonymous endpoint, each run launches two real browser crawls — cap
  // tighter than the single-report path (report:) since it does double the
  // work per submission.
  const ip = await getClientIp();
  const limit = checkRateLimit(`compare:${ip}`, 10 * 60 * 1000, 4);
  if (!limit.allowed) {
    return {
      status: "error",
      error: `Too many comparisons from this connection. ${formatRetryAfter(limit.retryAfterMs)}`,
    };
  }

  const [a, b] = await Promise.all([
    runSide(inputA.url),
    runSide(inputB.url),
  ]);
  return { status: "success", a, b };
}
