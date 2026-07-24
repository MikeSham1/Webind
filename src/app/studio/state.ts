// Plain module (NOT a server-action file) so it can export non-function values.
// A server-action file may only export async functions.

import type { ContentDraft, DraftStatus } from "@/lib/content/types";

export type StudioState =
  | { status: "idle" }
  | { status: "created"; draft: ContentDraft; draftId: string | null }
  | { status: "error"; error: string };

export const initialStudioState: StudioState = { status: "idle" };

export type DecisionState =
  | { status: "idle" }
  | { status: "done"; decision: DraftStatus }
  | { status: "error"; error: string };

export const initialDecisionState: DecisionState = { status: "idle" };
