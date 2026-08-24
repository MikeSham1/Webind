"use server";

import { getCurrentUser } from "@/lib/auth";
import { getReportForUser } from "@/lib/leads";
import { crawl } from "@/lib/crawler/crawl";
import { CrawlerBusyError } from "@/lib/crawler/browser";
import { BlockedUrlError, normalizeUrl } from "@/lib/crawler/ssrf";
import { checkRateLimit, formatRetryAfter } from "@/lib/rateLimit";
import { buildSnapshot } from "@/lib/fixgen/snapshot";
import {
  buildMetaDescriptionContext,
  buildSchemaContext,
  type ContextOrNoFix,
} from "@/lib/fixgen/context";
import { generateFixes } from "@/lib/fixgen/generate";
import {
  candidateOwnerUserId,
  getRunWithCandidates,
  persistFixRun,
  saveReview,
  type ReviewDecision,
} from "@/lib/fixgen/store";
import type { FixGenState, ReviewState } from "./state";

const CATEGORY_BUILDERS: Record<string, (s: ReturnType<typeof buildSnapshot>) => ContextOrNoFix> = {
  metadata: buildMetaDescriptionContext,
  schema: buildSchemaContext,
};

/**
 * Generate reviewed fix candidates for one signal on the owner's saved report.
 *
 * Owner-scoped (never the admin bypass — writing external fixes stays owner-only)
 * and rate-limited (each run is a real crawl + a model call). Crawls FRESH and
 * snapshots that state, so the recommendation is bound to the exact page it was
 * based on. Only VALIDATED candidates are returned for review; rejected ones are
 * persisted as signal but never shown.
 */
export async function generateFixAction(
  _prev: FixGenState,
  formData: FormData,
): Promise<FixGenState> {
  const user = await getCurrentUser();
  if (!user) return { status: "error", error: "Log in to generate a fix." };

  const requestId = String(formData.get("requestId") ?? "");
  const category = String(formData.get("category") ?? "");
  const build = CATEGORY_BUILDERS[category];
  if (!build) return { status: "error", error: "Unknown fix category." };

  const limit = checkRateLimit(`fixgen:${user.id}`, 60 * 60 * 1000, 20);
  if (!limit.allowed) return { status: "error", error: formatRetryAfter(limit.retryAfterMs) };

  const report = await getReportForUser(requestId, user.id);
  if (!report) return { status: "error", error: "Couldn't find that report." };

  const url = normalizeUrl(report.url);
  if (!url) return { status: "error", error: "That report's URL is invalid." };

  let page;
  try {
    page = await crawl(url);
  } catch (err) {
    if (err instanceof BlockedUrlError || err instanceof CrawlerBusyError) {
      return { status: "error", error: err.message };
    }
    return { status: "error", error: "We couldn't reach that site to generate a fix." };
  }

  const snapshot = buildSnapshot(page);
  const gate = build(snapshot);
  if (gate.kind === "no_fix") return { status: "no_fix", reason: gate.reason, category };

  const outcome = await generateFixes(gate.context);
  if (outcome.generation.fallback) {
    return { status: "error", error: "The fix generator is unavailable right now — try again shortly." };
  }
  if (outcome.accepted.length === 0) {
    return {
      status: "no_fix",
      reason: outcome.rejected.length ? "insufficient_evidence" : "already_optimal",
      category,
    };
  }

  const ids = await persistFixRun(snapshot, gate.context, outcome, user.id);
  if (!ids) {
    // Persistence off (no DATABASE_URL) — still show the candidates, without review.
    return {
      status: "candidates",
      runId: "",
      category,
      candidates: outcome.accepted.map((candidate) => ({ dbId: "", candidate })),
    };
  }

  const loaded = await getRunWithCandidates(ids.runId);
  const candidates = (loaded?.candidates ?? [])
    .filter((c) => c.validationOk)
    .map((c) => ({ dbId: c.id, candidate: c.candidate }));
  return { status: "candidates", runId: ids.runId, category, candidates };
}

const VALID_DECISIONS: ReviewDecision[] = [
  "accepted_unedited",
  "accepted_minor_edit",
  "accepted_major_edit",
  "rejected",
  "skipped",
];

/**
 * Record the human's decision on a candidate. Owner-only: the candidate must
 * belong to a run the current user owns. Nothing here writes to a live site —
 * that stays behind the existing publication authority.
 */
export async function submitReviewAction(
  _prev: ReviewState,
  formData: FormData,
): Promise<ReviewState> {
  const user = await getCurrentUser();
  if (!user) return { status: "error", error: "Log in to review." };

  const candidateId = String(formData.get("candidateId") ?? "");
  const decision = String(formData.get("decision") ?? "") as ReviewDecision;
  if (!candidateId) return { status: "error", error: "Missing candidate." };
  if (!VALID_DECISIONS.includes(decision)) return { status: "error", error: "Invalid decision." };

  const owner = await candidateOwnerUserId(candidateId);
  if (owner === null || owner !== user.id) {
    return { status: "error", error: "That candidate isn't yours to review." };
  }

  const humanFinal = String(formData.get("humanFinal") ?? "").trim() || null;
  const rejectionReason = String(formData.get("rejectionReason") ?? "").trim() || null;
  const id = await saveReview({
    candidateId,
    reviewerUserId: user.id,
    decision,
    humanFinal,
    rejectionReason,
  });
  if (!id) return { status: "error", error: "Couldn't save your review." };
  return { status: "saved", decision, candidateId };
}
