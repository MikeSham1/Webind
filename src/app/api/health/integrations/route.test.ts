import { describe, it, expect, vi, beforeEach } from "vitest";

const getCurrentUser = vi.fn();
vi.mock("@/lib/auth", () => ({ getCurrentUser: () => getCurrentUser() }));

import { GET } from "./route";

describe("GET /api/health/integrations", () => {
  beforeEach(() => getCurrentUser.mockReset());

  it("404s for anonymous and non-admin users (doesn't reveal itself)", async () => {
    getCurrentUser.mockResolvedValue(null);
    expect((await GET()).status).toBe(404);

    getCurrentUser.mockResolvedValue({ id: "u", isAdmin: false });
    expect((await GET()).status).toBe(404);
  });

  it("returns a booleans-only status for an admin, never a secret value", async () => {
    getCurrentUser.mockResolvedValue({ id: "u", isAdmin: true });
    const res = await GET();
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(typeof body.core.database).toBe("boolean");
    expect(typeof body.ai.gemini).toBe("boolean");
    expect(typeof body.benchmark.serper).toBe("boolean");
    expect(typeof body.coreWebVitals.psi).toBe("boolean");
    expect(typeof body.stripe.configured).toBe("boolean");
    expect(["test", "live", "off"]).toContain(body.stripe.mode);

    // Nothing in the payload looks like an actual key/secret.
    expect(JSON.stringify(body)).not.toMatch(/sk_|rk_|whsec_|price_|AIza|sk-ant/);
  });
});
