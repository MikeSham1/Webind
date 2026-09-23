import { describe, it, expect, vi, beforeEach } from "vitest";

const getCurrentUser = vi.fn();
vi.mock("@/lib/auth", () => ({ getCurrentUser: () => getCurrentUser() }));

// The probe must never make a real network call in tests.
const generate = vi.fn();
vi.mock("@/lib/ai/generator", () => ({ generate: (...a: unknown[]) => generate(...a) }));

import { GET } from "./route";

const URL_BASE = "https://example.com/api/health/integrations";
/** Next always hands the handler a Request; mirror that here. */
const req = (query = "") => new Request(`${URL_BASE}${query}`);

describe("GET /api/health/integrations", () => {
  beforeEach(() => {
    getCurrentUser.mockReset();
    generate.mockReset();
  });

  it("404s for anonymous and non-admin users (doesn't reveal itself)", async () => {
    getCurrentUser.mockResolvedValue(null);
    expect((await GET(req())).status).toBe(404);

    getCurrentUser.mockResolvedValue({ id: "u", isAdmin: false });
    expect((await GET(req())).status).toBe(404);
  });

  it("returns a booleans-only status for an admin, never a secret value", async () => {
    getCurrentUser.mockResolvedValue({ id: "u", isAdmin: true });
    const res = await GET(req());
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

  it("does not spend an API call unless the probe is asked for", async () => {
    getCurrentUser.mockResolvedValue({ id: "u", isAdmin: true });
    const body = await (await GET(req())).json();

    expect(generate).not.toHaveBeenCalled();
    expect(body.ai.geminiProbe).toBeNull();
    // Key shape is always reported — it's free and it's the usual culprit.
    expect(typeof body.ai.geminiKey.present).toBe("boolean");
    expect(typeof body.ai.geminiModel).toBe("string");
  });

  it("surfaces the provider's real error when probing, so a set-but-broken key is visible", async () => {
    getCurrentUser.mockResolvedValue({ id: "u", isAdmin: true });
    generate.mockResolvedValue({
      provider: "gemini",
      model: "gemini-3.7-flash",
      text: "",
      inputTokens: 0,
      outputTokens: 0,
      durationMs: 0,
      purpose: "health_probe",
      fallback: true,
      error: "API key not valid. Please pass a valid API key.",
    });

    const body = await (await GET(req("?probe=gemini"))).json();

    expect(generate).toHaveBeenCalledTimes(1);
    expect(body.ai.geminiProbe.ok).toBe(false);
    expect(body.ai.geminiProbe.error).toMatch(/API key not valid/);
  });

  it("reports a healthy probe as ok", async () => {
    getCurrentUser.mockResolvedValue({ id: "u", isAdmin: true });
    generate.mockResolvedValue({
      provider: "gemini",
      model: "gemini-3.7-flash",
      text: "ok",
      inputTokens: 8,
      outputTokens: 2,
      durationMs: 5,
      purpose: "health_probe",
      fallback: false,
      finishReason: "STOP",
    });

    const body = await (await GET(req("?probe=gemini"))).json();
    expect(body.ai.geminiProbe.ok).toBe(true);
    expect(body.ai.geminiProbe.error).toBeNull();
  });
});
