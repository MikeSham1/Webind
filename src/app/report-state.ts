// Plain module (NOT a server-action file) so it can export non-function values.
// A server-action file may only export async functions, so the state types and
// their initial values live here and are imported by the action + the client.

import type { OptimizationAssets } from "@/lib/optimize/assets";
import type { ReportResult } from "@/lib/scoring/types";

/** Result of a report run, shaped for `useActionState`. */
export type ReportState =
  | { status: "idle" }
  | {
      status: "success";
      report: ReportResult;
      narrative: string;
      /** Ready-to-apply fixes generated from the crawl (deterministic). */
      optimizations: OptimizationAssets;
      /** DB id of the logged run, or null when persistence is disabled. */
      requestId: string | null;
      /** Whether the signed-in visitor has a GitHub repo connected (Settings). */
      githubConnected: boolean;
      /**
       * Experimental: the Claude-distilled model's readiness prediction (0-100).
       * Runs alongside — never replaces — the heuristic scores. See predict.ts.
       */
      modelReadiness: number;
    }
  | { status: "error"; error: string; url: string };

export const initialReportState: ReportState = { status: "idle" };

/** State for the lead-capture (email) form. */
export type LeadState =
  | { status: "idle" }
  | { status: "done" }
  | { status: "error"; error: string };

export const initialLeadState: LeadState = { status: "idle" };

/** State for the "open a PR" action (Phase 3 one-click apply for code fixes). */
export type PrState =
  | { status: "idle" }
  | { status: "opened"; prUrl: string; prNumber: number }
  | { status: "error"; error: string };

export const initialPrState: PrState = { status: "idle" };
