import { describe, it, expect } from "vitest";
import { transcriptText } from "./planner-state";

describe("transcriptText", () => {
  it("renders an empty conversation as an empty string", () => {
    expect(transcriptText([])).toBe("");
  });

  it("labels user and assistant turns and joins them with a blank line", () => {
    const text = transcriptText([
      { role: "user", text: "I need a landing page" },
      { role: "assistant", text: "What's the target audience?" },
    ]);
    expect(text).toBe(
      "User: I need a landing page\n\nWebind: What's the target audience?",
    );
  });
});
