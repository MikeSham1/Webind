"use server";

import { getCurrentUser } from "@/lib/auth";
import { checkKeywordVisibility } from "@/lib/visibility/check";
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

  const domain = String(formData.get("domain") ?? "").trim();
  const brandName = String(formData.get("brandName") ?? "").trim() || undefined;
  const keywords = parseKeywords(String(formData.get("keywords") ?? ""));

  const result = await checkKeywordVisibility({ domain, brandName, keywords });
  return result.ok
    ? { status: "success", report: result.report }
    : { status: "error", error: result.error };
}
