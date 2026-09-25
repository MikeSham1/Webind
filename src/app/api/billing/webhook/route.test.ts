import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  constructWebhookEvent: vi.fn(),
  upsertSubscription: vi.fn(),
  wasStripeEventProcessed: vi.fn(),
  markStripeEventProcessed: vi.fn(),
}));

vi.mock("@/lib/billing/stripe", () => ({
  constructWebhookEvent: mocks.constructWebhookEvent,
}));
vi.mock("@/lib/billing/store", () => ({
  upsertSubscription: mocks.upsertSubscription,
  wasStripeEventProcessed: mocks.wasStripeEventProcessed,
  markStripeEventProcessed: mocks.markStripeEventProcessed,
}));

function subscriptionEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: "evt_1",
    type: "customer.subscription.updated",
    created: 1_700_000_000,
    data: {
      object: {
        id: "sub_1",
        customer: "cus_1",
        status: "active",
        metadata: { userId: "u1", plan: "starter" },
        items: { data: [{ price: { id: "price_starter" } }] },
        ...overrides,
      },
    },
  };
}

function req(body = "{}"): Request {
  return new Request("http://localhost/api/billing/webhook", {
    method: "POST",
    headers: { "stripe-signature": "t=1,v1=abc" },
    body,
  });
}

async function loadRoute() {
  vi.resetModules();
  return import("./route");
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/billing/webhook", () => {
  it("rejects a request with no signature header without even parsing the body", async () => {
    const { POST } = await loadRoute();
    const res = await POST(
      new Request("http://localhost/api/billing/webhook", { method: "POST", body: "{}" }),
    );
    expect(res.status).toBe(400);
    expect(mocks.constructWebhookEvent).not.toHaveBeenCalled();
  });

  it("rejects an invalid/unverifiable signature", async () => {
    mocks.constructWebhookEvent.mockReturnValue(null);
    const { POST } = await loadRoute();
    const res = await POST(req());
    expect(res.status).toBe(400);
  });

  it("acknowledges a valid event once its write succeeds, and marks it processed", async () => {
    mocks.constructWebhookEvent.mockReturnValue(subscriptionEvent());
    mocks.wasStripeEventProcessed.mockResolvedValue(false);
    mocks.upsertSubscription.mockResolvedValue("applied");

    const { POST } = await loadRoute();
    const res = await POST(req());

    expect(res.status).toBe(200);
    expect(mocks.markStripeEventProcessed).toHaveBeenCalledWith("evt_1", "customer.subscription.updated");
  });

  it("does NOT acknowledge when the subscription write fails — this used to return 200 anyway", async () => {
    mocks.constructWebhookEvent.mockReturnValue(subscriptionEvent());
    mocks.wasStripeEventProcessed.mockResolvedValue(false);
    mocks.upsertSubscription.mockResolvedValue("failed");

    const { POST } = await loadRoute();
    const res = await POST(req());

    expect(res.status).toBe(500);
    expect(mocks.markStripeEventProcessed).not.toHaveBeenCalled();
  });

  it("acknowledges without reprocessing an already-processed event id", async () => {
    mocks.constructWebhookEvent.mockReturnValue(subscriptionEvent());
    mocks.wasStripeEventProcessed.mockResolvedValue(true);

    const { POST } = await loadRoute();
    const res = await POST(req());

    expect(res.status).toBe(200);
    expect(mocks.upsertSubscription).not.toHaveBeenCalled();
    expect(mocks.markStripeEventProcessed).not.toHaveBeenCalled();
  });

  it("derives the plan from the subscription's actual price, not stale checkout-time metadata", async () => {
    process.env.STRIPE_PRICE_GROWTH = "price_growth_live";
    mocks.constructWebhookEvent.mockReturnValue(
      subscriptionEvent({
        metadata: { userId: "u1", plan: "starter" }, // stale — set once at checkout
        items: { data: [{ price: { id: "price_growth_live" } }] }, // actual current price
      }),
    );
    mocks.wasStripeEventProcessed.mockResolvedValue(false);
    mocks.upsertSubscription.mockResolvedValue("applied");

    const { POST } = await loadRoute();
    await POST(req());

    expect(mocks.upsertSubscription).toHaveBeenCalledWith(
      expect.objectContaining({ plan: "growth" }),
    );
    delete process.env.STRIPE_PRICE_GROWTH;
  });
});
