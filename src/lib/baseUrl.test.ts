import { afterEach, describe, expect, it, vi } from "vitest";

const mockHeaders = vi.hoisted(() => ({ store: new Map<string, string>() }));
vi.mock("next/headers", () => ({
  headers: async () => ({
    get: (name: string) => mockHeaders.store.get(name.toLowerCase()) ?? null,
  }),
}));

async function loadBaseUrl() {
  vi.resetModules();
  return import("./baseUrl");
}

afterEach(() => {
  vi.unstubAllEnvs();
  mockHeaders.store.clear();
});

describe("getBaseUrl", () => {
  it("prefers APP_BASE_URL over the request's forwarded headers — those are attacker-controlled unless a proxy strips them, and this function's output lands in password-reset links", async () => {
    vi.stubEnv("APP_BASE_URL", "https://webind.design");
    mockHeaders.store.set("x-forwarded-host", "evil.example");
    mockHeaders.store.set("x-forwarded-proto", "https");

    const { getBaseUrl } = await loadBaseUrl();
    expect(await getBaseUrl()).toBe("https://webind.design");
  });

  it("strips a trailing slash from the configured value", async () => {
    vi.stubEnv("APP_BASE_URL", "https://webind.design/");
    const { getBaseUrl } = await loadBaseUrl();
    expect(await getBaseUrl()).toBe("https://webind.design");
  });

  it("falls back to forwarded headers when APP_BASE_URL is unset (local/preview)", async () => {
    vi.stubEnv("APP_BASE_URL", "");
    mockHeaders.store.set("x-forwarded-host", "preview-123.example");
    mockHeaders.store.set("x-forwarded-proto", "https");

    const { getBaseUrl } = await loadBaseUrl();
    expect(await getBaseUrl()).toBe("https://preview-123.example");
  });

  it("falls back to localhost when nothing is configured or forwarded", async () => {
    vi.stubEnv("APP_BASE_URL", "");
    const { getBaseUrl } = await loadBaseUrl();
    expect(await getBaseUrl()).toBe("http://localhost:3000");
  });
});
