import { afterEach, describe, expect, it, vi } from "vitest";
import {
  GATE_COOKIE,
  gateToken,
  isPublicLaunch,
  safeEqual,
  selfScanGateCookie,
  sitePassword,
} from "./gate";

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

describe("isPublicLaunch", () => {
  it("is false unless SITE_PUBLIC is exactly \"true\"", () => {
    vi.stubEnv("SITE_PUBLIC", "");
    expect(isPublicLaunch()).toBe(false);
    vi.stubEnv("SITE_PUBLIC", "1");
    expect(isPublicLaunch()).toBe(false);
    vi.stubEnv("SITE_PUBLIC", "TRUE");
    expect(isPublicLaunch()).toBe(false);
  });

  it("is true when SITE_PUBLIC=true", () => {
    vi.stubEnv("SITE_PUBLIC", "true");
    expect(isPublicLaunch()).toBe(true);
  });
});

describe("GATE_COOKIE", () => {
  it("is a stable cookie name", () => {
    expect(GATE_COOKIE).toBe("wb_gate");
  });
});

describe("selfScanGateCookie", () => {
  function setup() {
    vi.stubEnv("SITE_PASSWORD", "Mshamoyan2026");
    vi.stubEnv("SITE_PUBLIC", "");
    vi.stubEnv("APP_BASE_URL", "https://webinddesign.com");
  }

  it("returns the gate cookie for a URL on the configured origin", async () => {
    setup();
    const cookie = await selfScanGateCookie("https://webinddesign.com/pricing");
    expect(cookie).toEqual({
      name: GATE_COOKIE,
      value: await gateToken("Mshamoyan2026"),
      url: "https://webinddesign.com",
    });
  });

  it("returns null for a different origin", async () => {
    setup();
    expect(await selfScanGateCookie("https://example.com/")).toBeNull();
  });

  it("returns null when APP_BASE_URL is unset — never falls back to request headers", async () => {
    vi.stubEnv("SITE_PASSWORD", "Mshamoyan2026");
    vi.stubEnv("SITE_PUBLIC", "");
    vi.stubEnv("APP_BASE_URL", "");
    expect(await selfScanGateCookie("https://webinddesign.com/")).toBeNull();
  });

  it("returns null when no password is configured", async () => {
    vi.stubEnv("SITE_PASSWORD", "");
    vi.stubEnv("SITE_PUBLIC", "");
    vi.stubEnv("APP_BASE_URL", "https://webinddesign.com");
    expect(await selfScanGateCookie("https://webinddesign.com/")).toBeNull();
  });

  it("returns null once the site is publicly launched (no gate to bypass)", async () => {
    vi.stubEnv("SITE_PASSWORD", "Mshamoyan2026");
    vi.stubEnv("SITE_PUBLIC", "true");
    vi.stubEnv("APP_BASE_URL", "https://webinddesign.com");
    expect(await selfScanGateCookie("https://webinddesign.com/")).toBeNull();
  });

  it("returns null for an unparseable target URL", async () => {
    setup();
    expect(await selfScanGateCookie("not a url")).toBeNull();
  });
});
