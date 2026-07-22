import { describe, it, expect } from "vitest";
import { AI_WEIGHTS, TRADITIONAL_WEIGHTS } from "./weights";

const sum = (obj: Record<string, number>) =>
  Object.values(obj).reduce((a, b) => a + b, 0);

describe("authority weights", () => {
  it("AI_WEIGHTS sum to 1", () => {
    expect(sum(AI_WEIGHTS)).toBeCloseTo(1, 5);
  });

  it("TRADITIONAL_WEIGHTS sum to 1", () => {
    expect(sum(TRADITIONAL_WEIGHTS)).toBeCloseTo(1, 5);
  });
});
