// Plain module (NOT a server-action file) so it can export non-function values.
// A server-action file may only export async functions, so the state types and
// their initial values live here and are imported by the action + the client.

import type { ReportResult } from "@/lib/scoring/types";

export type CompareSide =
  | { status: "ok"; report: ReportResult }
  | { status: "error"; error: string; url: string };

/** Result of a two-URL comparison run, shaped for `useActionState`. */
export type CompareState =
  | { status: "idle" }
  | { status: "success"; a: CompareSide; b: CompareSide }
  | { status: "error"; error: string };

export const initialCompareState: CompareState = { status: "idle" };
