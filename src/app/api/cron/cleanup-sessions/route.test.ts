import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.doUnmock("@/lib/auth");
});

async function loadRoute() {
  vi.resetModules();
  return import("./route");
}

describe("POST /api/cron/cleanup-sessions", () => {
  it("refuses everything (fail closed) when CRON_SECRET is unset", async () => {
    vi.stubEnv("CRON_SECRET", "");
    const { POST } = await loadRoute();
    const res = await POST(
      new Request("http://localhost/api/cron/cleanup-sessions", { method: "POST" }) as never,
    );
    expect(res.status).toBe(503);
  });

  it("rejects a missing or wrong bearer token", async () => {
    vi.stubEnv("CRON_SECRET", "topsecret");
    const { POST } = await loadRoute();

    const noAuth = await POST(
      new Request("http://localhost/api/cron/cleanup-sessions", { method: "POST" }) as never,
    );
    expect(noAuth.status).toBe(401);

    const wrongAuth = await POST(
      new Request("http://localhost/api/cron/cleanup-sessions", {
        method: "POST",
        headers: { authorization: "Bearer nope" },
      }) as never,
    );
    expect(wrongAuth.status).toBe(401);
  });

  it("runs the cleanup and reports the count with the correct bearer token", async () => {
    vi.stubEnv("CRON_SECRET", "topsecret");
    vi.doMock("@/lib/auth", () => ({ cleanupExpiredSessions: vi.fn(async () => 3) }));
    const { POST } = await loadRoute();

    const res = await POST(
      new Request("http://localhost/api/cron/cleanup-sessions", {
        method: "POST",
        headers: { authorization: "Bearer topsecret" },
      }) as never,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ removed: 3 });
  });
});
