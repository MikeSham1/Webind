import { describe, expect, it } from "vitest";
import { plannerErrorFor } from "./planner-errors";

/**
 * Every one of these used to render as the same "Gemini planning is
 * unavailable right now", which is why a broken deployment was undiagnosable
 * from the UI. The point of each case is that the reader can tell whether it's
 * theirs to fix.
 */
describe("planner error messages name the actual cause", () => {
  it("says the key is missing when the provider isn't configured", () => {
    expect(plannerErrorFor("gemini is not configured")).toMatch(/GEMINI_API_KEY is missing/);
    // A fallback with no error at all means the same thing.
    expect(plannerErrorFor(undefined)).toMatch(/GEMINI_API_KEY is missing/);
  });

  it("distinguishes a rejected key from a missing one", () => {
    const msg = plannerErrorFor("API key not valid. Please pass a valid API key.");
    expect(msg).toMatch(/rejected/i);
    expect(msg).not.toMatch(/missing/i);
  });

  it("recognizes the other shapes Google returns for a bad credential", () => {
    for (const e of ["got status: 401 Unauthenticated", "PERMISSION_DENIED", "403 Forbidden"]) {
      expect(plannerErrorFor(e)).toMatch(/rejected/i);
    }
  });

  it("calls out quota exhaustion as a limit, not a misconfiguration", () => {
    for (const e of ["429 RESOURCE_EXHAUSTED", "Quota exceeded", "rate limit reached"]) {
      expect(plannerErrorFor(e)).toMatch(/quota/i);
    }
  });

  it("explains a starved token budget in terms the user can act on", () => {
    const msg = plannerErrorFor(
      "empty response: maxOutputTokens (2048) exhausted, 2048 of it on reasoning",
    );
    expect(msg).toMatch(/ran out of room/i);
  });

  it("points at the model setting when the model doesn't exist", () => {
    expect(plannerErrorFor("models/gemini-9-flash is not found")).toMatch(
      /GEMINI_GENERATOR_MODEL/,
    );
  });

  it("treats a safety stop as a rephrase, not a failure", () => {
    expect(plannerErrorFor("empty response (finishReason: SAFETY)")).toMatch(/rephras/i);
  });

  it("falls back to a retry message for anything unrecognized", () => {
    expect(plannerErrorFor("ECONNRESET")).toMatch(/temporarily unavailable/i);
  });

  it("never echoes the raw provider text back to the user", () => {
    const raw = "fetch to https://generativelanguage.googleapis.com/v1beta/x?key=AIzaSECRET failed";
    const msg = plannerErrorFor(raw);
    expect(msg).not.toContain("AIzaSECRET");
    expect(msg).not.toContain("googleapis.com");
  });

  it("always offers the manual path so the user is never stuck", () => {
    for (const e of [undefined, "401", "quota", "ECONNRESET", "SAFETY"]) {
      expect(plannerErrorFor(e)).toMatch(/writing brief below/);
    }
  });
});
