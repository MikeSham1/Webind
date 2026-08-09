import { describe, expect, it } from "vitest";
import { summarizeUserAgent } from "./userAgent";

describe("summarizeUserAgent", () => {
  it("returns Unknown device for null", () => {
    expect(summarizeUserAgent(null)).toBe("Unknown device");
  });

  it("identifies Chrome on Windows", () => {
    expect(
      summarizeUserAgent(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      ),
    ).toBe("Chrome on Windows");
  });

  it("identifies Safari on macOS distinctly from Chrome", () => {
    expect(
      summarizeUserAgent(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
      ),
    ).toBe("Safari on macOS");
  });

  it("identifies Safari on iOS", () => {
    expect(
      summarizeUserAgent(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
      ),
    ).toBe("Safari on iOS");
  });

  it("falls back to a generic label for an unrecognized UA", () => {
    expect(summarizeUserAgent("SomeBot/1.0")).toBe("A browser");
  });
});
