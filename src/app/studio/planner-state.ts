export interface PlannerMessage {
  role: "user" | "assistant";
  text: string;
}

export type PlannerState =
  | { status: "idle"; messages: PlannerMessage[] }
  | { status: "reply"; reply: string; messages: PlannerMessage[] }
  | { status: "error"; error: string; messages: PlannerMessage[] };

export const initialPlannerState: PlannerState = { status: "idle", messages: [] };

/** Flatten the conversation into the text block sent to the planning model. */
export function transcriptText(messages: PlannerMessage[]): string {
  return messages
    .map((m) => `${m.role === "user" ? "User" : "Webind"}: ${m.text}`)
    .join("\n\n");
}
