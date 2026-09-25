import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "./proxy";

function req(path: string): NextRequest {
  return new NextRequest(new URL(path, "http://localhost:3000"));
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("proxy", () => {
  it("lets the Stripe webhook through without the gate cookie, password set or not", async () => {
    vi.stubEnv("SITE_PASSWORD", "secret");
    const res = await proxy(req("/api/billing/webhook"));
    expect(res.status).toBe(200); // NextResponse.next()
    expect(res.headers.get("location")).toBeNull();
  });

  it("redirects an ungated request to /splash when a password is configured", async () => {
    vi.stubEnv("SITE_PASSWORD", "secret");
    const res = await proxy(req("/dashboard"));
    expect(res.headers.get("location")).toContain("/splash");
  });

  it("still redirects to /splash when SITE_PASSWORD is unset and SITE_PUBLIC is not set — unsetting the password alone must not open the site", async () => {
    vi.stubEnv("SITE_PASSWORD", "");
    vi.stubEnv("SITE_PUBLIC", "");
    const res = await proxy(req("/dashboard"));
    expect(res.headers.get("location")).toContain("/splash");
  });

  it("opens every route when SITE_PUBLIC=true, regardless of SITE_PASSWORD", async () => {
    vi.stubEnv("SITE_PASSWORD", "secret");
    vi.stubEnv("SITE_PUBLIC", "true");
    const res = await proxy(req("/dashboard"));
    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
  });
});
