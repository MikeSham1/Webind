import { afterEach, describe, expect, it, vi } from "vitest";
import { GATE_COOKIE, gateToken, safeEqual, sitePassword } from "./gate";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("gateToken", () => {
  it("is deterministic for a given password", async () => {
    expect(await gateToken("secret")).toBe(await gateToken("secret"));
  });

  it("differs for different passwords and is not the password itself", async () => {
    const a = await gateToken("secret");
    const b = await gateToken("other");
    expect(a).not.toBe(b);
    expect(a).not.toContain("secret");
    expect(a).toMatch(/^[0-9a-f]{64}$/); // hex sha-256 hmac
  });
});

describe("safeEqual", () => {
  it("matches equal strings and rejects unequal/length-mismatched ones", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
  });
});

describe("sitePassword", () => {
  it("returns null when unset or empty (fail closed)", () => {
    vi.stubEnv("SITE_PASSWORD", "");
    expect(sitePassword()).toBeNull();
  });

  it("returns the configured password", () => {
    vi.stubEnv("SITE_PASSWORD", "Mshamoyan2026");
    expect(sitePassword()).toBe("Mshamoyan2026");
  });
});

describe("GATE_COOKIE", () => {
  it("is a stable cookie name", () => {
    expect(GATE_COOKIE).toBe("wb_gate");
  });
});
