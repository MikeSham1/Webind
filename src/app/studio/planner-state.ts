export type PlannerState =
  | { status: "idle"; transcript: string }
  | { status: "reply"; reply: string; transcript: string }
  | { status: "error"; error: string; transcript: string };

export const initialPlannerState: PlannerState = { status: "idle", transcript: "" };
