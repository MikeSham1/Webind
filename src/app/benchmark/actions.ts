"use server";

import { getCurrentUser } from "@/lib/auth";
import { runBenchmark } from "@/lib/benchmark/benchmark";
import {
  finishBenchmarkRun,
  saveBenchmarkProgress,
  startOrResumeBenchmarkRun,
} from "@/lib/benchmark/store";
import { parseDomainInput } from "@/lib/domainInput";
import { checkRateLimit, formatRetryAfter } from "@/lib/rateLimit";
import type { BenchmarkState } from "./state";

/**
 * Run a competitive benchmark for the signed-in user.
 *
 * Auth-gated and tightly rate-limited: a single run does a SERP lookup plus up
 * to a dozen live crawls, so it's far heavier than the free report — easily
 * minutes long. Checkpointed via benchmark/store so a timeout or a closed tab
 * partway through doesn't throw away completed work: the next call with the
 * same url+query resumes from the last checkpoint instead of re-crawling
 * everything. Never throws to the client — bad input and a missing SERP key
 * both return friendly states (the latter as a configured:false report the
 * UI explains).
 */
export async function runBenchmarkAction(
  _prev: BenchmarkState,
  formData: FormData,
): Promise<BenchmarkState> {
  const user = await getCurrentUser();
  if (!user) {
    return { status: "error", error: "Please log in to run a competitive benchmark." };
  }

  // One run = a SERP call + many browser crawls. Keep it scarce per user.
  const limit = checkRateLimit(`benchmark:${user.id}`, 60 * 60 * 1000, 8);
  if (!limit.allowed) {
    return { status: "error", error: formatRetryAfter(limit.retryAfterMs) };
  }

  const rawUrl = String(formData.get("url") ?? "");
  const query = String(formData.get("query") ?? "").trim();

  const domainInput = parseDomainInput(rawUrl);
  if (!domainInput.ok) {
    return { status: "error", error: domainInput.error };
  }
  if (!query) {
    return { status: "error", error: "Enter the search query you want to win." };
  }

  const { id: runId, progress } = await startOrResumeBenchmarkRun(
    user.id,
    domainInput.url,
    query,
  );

  try {
    const report = await runBenchmark(
      { url: domainInput.url, query },
      {},
      progress,
      (p) => saveBenchmarkProgress(runId, p),
    );
    await finishBenchmarkRun(runId, "done");
    return { status: "success", report };
  } catch {
    // A clean, handled failure — nothing left to resume, so mark it terminal.
    // If the process dies instead of reaching this catch, the run stays
    // `running` at its last checkpoint, which is the resumable path.
    await finishBenchmarkRun(runId, "failed");
    return {
      status: "error",
      error: "The benchmark couldn't complete. Please try again shortly.",
    };
  }
}
