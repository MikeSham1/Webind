// Plain module (not a server-action file) so it can export non-function values.

import type { FixCandidate } from "@/lib/fixgen/types";

export interface ReviewCandidate {
  /** DB id of the persisted candidate (empty string when persistence is off). */
  dbId: string;
  candidate: FixCandidate;
}

export type FixGenState =
  | { status: "idle" }
  | { status: "no_fix"; reason: string; category: string }
  | { status: "candidates"; runId: string; category: string; candidates: ReviewCandidate[] }
  | { status: "error"; error: string };

export const initialFixGenState: FixGenState = { status: "idle" };

export type ReviewState =
  | { status: "idle" }
  | { status: "saved"; decision: string; candidateId: string }
  | { status: "error"; error: string };

export const initialReviewState: ReviewState = { status: "idle" };
