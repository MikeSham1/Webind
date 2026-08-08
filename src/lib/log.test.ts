import { afterEach, describe, expect, it, vi } from "vitest";
import { logInfo, logWarn, timed } from "./log";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("logInfo / logWarn", () => {
  it("writes a single JSON line with the event, level, and fields", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    logInfo("test.event", { foo: "bar", n: 1 });
    expect(spy).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse(spy.mock.calls[0][0] as string);
    expect(parsed).toMatchObject({ level: "info", event: "test.event", foo: "bar", n: 1 });
    expect(typeof parsed.ts).toBe("string");
  });

  it("routes warnings to console.warn", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    logWarn("test.warn", {});
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe("timed", () => {
  it("logs .ok with a duration on success and returns the result", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const result = await timed("op", { id: "x" }, async () => 42);
    expect(result).toBe(42);
    const parsed = JSON.parse(spy.mock.calls[0][0] as string);
    expect(parsed.event).toBe("op.ok");
    expect(parsed.id).toBe("x");
    expect(typeof parsed.durationMs).toBe("number");
  });

  it("logs .error and rethrows on failure", async () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(
      timed("op", {}, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    const parsed = JSON.parse(spy.mock.calls[0][0] as string);
    expect(parsed.event).toBe("op.error");
    expect(parsed.error).toBe("boom");
  });
});
