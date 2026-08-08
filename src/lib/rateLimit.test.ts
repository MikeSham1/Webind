import { afterEach, describe, expect, it, vi } from "vitest";
import { __resetRateLimits, checkRateLimit, formatRetryAfter } from "./rateLimit";

afterEach(() => {
  __resetRateLimits();
  vi.useRealTimers();
});

describe("checkRateLimit", () => {
  it("allows up to `max` hits within the window, then blocks", () => {
    const key = "ip:1.2.3.4";
    expect(checkRateLimit(key, 1000, 3).allowed).toBe(true);
    expect(checkRateLimit(key, 1000, 3).allowed).toBe(true);
    expect(checkRateLimit(key, 1000, 3).allowed).toBe(true);
    const fourth = checkRateLimit(key, 1000, 3);
    expect(fourth.allowed).toBe(false);
    expect(fourth.retryAfterMs).toBeGreaterThan(0);
  });

  it("keys are independent", () => {
    checkRateLimit("a", 1000, 1);
    expect(checkRateLimit("a", 1000, 1).allowed).toBe(false);
    expect(checkRateLimit("b", 1000, 1).allowed).toBe(true);
  });

  it("allows again once the window has rolled past the oldest hit", () => {
    vi.useFakeTimers();
    const key = "sliding";
    expect(checkRateLimit(key, 1000, 1).allowed).toBe(true);
    expect(checkRateLimit(key, 1000, 1).allowed).toBe(false);
    vi.advanceTimersByTime(1001);
    expect(checkRateLimit(key, 1000, 1).allowed).toBe(true);
  });
});

describe("formatRetryAfter", () => {
  it("formats sub-minute waits in seconds", () => {
    expect(formatRetryAfter(5000)).toBe("Please wait 5 seconds and try again.");
    expect(formatRetryAfter(1000)).toBe("Please wait 1 second and try again.");
  });

  it("formats longer waits in minutes, rounded up", () => {
    expect(formatRetryAfter(61_000)).toBe("Please wait 2 minutes and try again.");
    expect(formatRetryAfter(60_000)).toBe("Please wait 1 minute and try again.");
  });

  it("never reports zero, even for a near-zero wait", () => {
    expect(formatRetryAfter(10)).toBe("Please wait 1 second and try again.");
  });
});
