"use server";

import { getCurrentUser } from "@/lib/auth";
import { checkKeywordVisibility } from "@/lib/visibility/check";
import { saveVisibilityOutcome } from "@/lib/visibility/store";
import { checkRateLimit, formatRetryAfter } from "@/lib/rateLimit";
import type { VisibilityState } from "./state";

function parseKeywords(raw: string): string[] {
  return raw
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Run a keyword-visibility check for the signed-in user.
 *
 * Auth-gated: real answer-engine probes cost API calls, so this is not exposed
 * to anonymous traffic (unlike the free report). Never throws to the client —
 * `checkKeywordVisibility` returns a friendly error for bad input, and a run
 * with no configured engine still succeeds with null scores so the UI can
 * prompt for a key.
 */
export async function runVisibilityCheck(
  _prev: VisibilityState,
  formData: FormData,
): Promise<VisibilityState> {
  const user = await getCurrentUser();
  if (!user) {
    return { status: "error", error: "Please log in to run a visibility check." };
  }

  // Each keyword probes a real answer-engine API — cap per-user throughput.
  const limit = checkRateLimit(`visibility:${user.id}`, 60 * 60 * 1000, 15);
  if (!limit.allowed) {
    return { status: "error", error: formatRetryAfter(limit.retryAfterMs) };
  }

  const domain = String(formData.get("domain") ?? "").trim();
  const brandName = String(formData.get("brandName") ?? "").trim() || undefined;
  const keywords = parseKeywords(String(formData.get("keywords") ?? ""));

  const result = await checkKeywordVisibility({ domain, brandName, keywords });
  if (!result.ok) {
    return { status: "error", error: result.error };
  }

  // Persist the measured AI-surfacing outcome as ground-truth training data for
  // the readiness model. Best-effort — never blocks or breaks the user's check.
  await saveVisibilityOutcome(result.report, user.id);

  return { status: "success", report: result.report };
}
