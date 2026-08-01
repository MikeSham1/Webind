// Plain module (NOT a server-action file) so it can export non-function values.
import type { VisibilityReport } from "@/lib/visibility/types";

export type VisibilityState =
  | { status: "idle" }
  | { status: "success"; report: VisibilityReport }
  | { status: "error"; error: string };

export const initialVisibilityState: VisibilityState = { status: "idle" };
