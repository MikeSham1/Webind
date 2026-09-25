import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  isBillingConfigured: vi.fn(),
  createCheckoutSession: vi.fn(),
  getSubscription: vi.fn(),
  hasActiveSubscription: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@/lib/baseUrl", () => ({ getBaseUrl: async () => "https://webind.design" }));
vi.mock("@/lib/billing/stripe", () => ({
  isBillingConfigured: mocks.isBillingConfigured,
  createCheckoutSession: mocks.createCheckoutSession,
}));
vi.mock("@/lib/billing/store", () => ({
  getSubscription: mocks.getSubscription,
  hasActiveSubscription: mocks.hasActiveSubscription,
}));

function req(body: unknown): Request {
  return new Request("http://localhost/api/billing/checkout", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function loadRoute() {
  vi.resetModules();
  return import("./route");
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/billing/checkout", () => {
  it("refuses a second checkout for a user who already has an active subscription", async () => {
    mocks.isBillingConfigured.mockReturnValue(true);
    mocks.getCurrentUser.mockResolvedValue({ id: "u1", email: "u1@example.com" });
    mocks.hasActiveSubscription.mockResolvedValue(true);

    const { POST } = await loadRoute();
    const res = await POST(req({ plan: "starter" }));

    expect(res.status).toBe(409);
    expect(mocks.createCheckoutSession).not.toHaveBeenCalled();
  });

  it("starts checkout for a user with no active subscription", async () => {
    mocks.isBillingConfigured.mockReturnValue(true);
    mocks.getCurrentUser.mockResolvedValue({ id: "u1", email: "u1@example.com" });
    mocks.hasActiveSubscription.mockResolvedValue(false);
    mocks.getSubscription.mockResolvedValue(null);
    mocks.createCheckoutSession.mockResolvedValue({ ok: true, url: "https://checkout.stripe.com/x" });

    const { POST } = await loadRoute();
    const res = await POST(req({ plan: "starter" }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ url: "https://checkout.stripe.com/x" });
  });
});
