import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/lib/db/schema";
import { __setTestDb } from "@/lib/db";
import { DEFAULT_PLAN, PLANS, planById, stripePriceId } from "./plans";
import {
  getSubscription,
  getUserPlan,
  hasActiveSubscription,
  markStripeEventProcessed,
  upsertSubscription,
  wasStripeEventProcessed,
} from "./store";
import { getQuota, recordUsage, usageThisMonth } from "./usage";
import {
  constructWebhookEvent,
  createBillingPortalSession,
  createCheckoutSession,
  isBillingConfigured,
  stripeMode,
} from "./stripe";

describe("plans config", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it("resolves plans by id and exposes a purchasable starter/growth", () => {
    expect(planById("starter")?.priceMonthly).toBe(19);
    expect(planById("growth")?.priceMonthly).toBe(79);
    expect(planById("nope")).toBeUndefined();
    // Free is not purchasable; paid plans carry a Stripe price env pointer.
    expect(planById("free")?.stripePriceEnv).toBeNull();
    expect(planById("starter")?.stripePriceEnv).toBe("STRIPE_PRICE_STARTER");
  });

  it("undercuts the field", () => {
    // Starter beats the cheapest dedicated tracker (Otterly $29).
    expect(planById("starter")!.priceMonthly).toBeLessThan(29);
    // Growth (multi-site, unlimited fixes) still lands under Peec (~$89) and
    // well under Profound/AthenaHQ ($295+).
    expect(planById("growth")!.priceMonthly).toBeLessThan(89);
    // Exactly one paid tier is flagged as the highlighted default.
    expect(PLANS.filter((p) => p.highlight)).toHaveLength(1);
  });

  it("reads the Stripe price id from the plan's env var at call time", () => {
    delete process.env.STRIPE_PRICE_STARTER;
    expect(stripePriceId(planById("starter")!)).toBeUndefined();
    process.env.STRIPE_PRICE_STARTER = "price_abc123";
    expect(stripePriceId(planById("starter")!)).toBe("price_abc123");
    // Free plan never has a price.
    expect(stripePriceId(planById("free")!)).toBeUndefined();
  });
});

describe("stripe helpers degrade safely without keys", () => {
  const saved = { ...process.env };
  beforeEach(() => {
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_WEBHOOK_SECRET;
  });
  afterEach(() => {
    process.env = { ...saved };
  });

  it("reports unconfigured when no secret key is set", () => {
    expect(isBillingConfigured()).toBe(false);
  });

  it("detects the Stripe mode from the key prefix (sandbox is the safe default)", () => {
    expect(stripeMode()).toBe("off");
    process.env.STRIPE_SECRET_KEY = "sk_test_abc";
    expect(stripeMode()).toBe("test");
    process.env.STRIPE_SECRET_KEY = "rk_test_abc";
    expect(stripeMode()).toBe("test");
    process.env.STRIPE_SECRET_KEY = "sk_live_abc";
    expect(stripeMode()).toBe("live");
    // Anything ambiguous is treated as test, never live.
    process.env.STRIPE_SECRET_KEY = "weird_key";
    expect(stripeMode()).toBe("test");
  });

  it("refuses checkout instead of throwing when unconfigured", async () => {
    const result = await createCheckoutSession({
      userId: "u1",
      email: "u1@example.com",
      plan: planById("starter")!,
      baseUrl: "https://webind.test",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/configured/i);
  });

  it("returns null (rejects) for a webhook when unconfigured", () => {
    expect(constructWebhookEvent("{}", "sig")).toBeNull();
  });

  it("refuses to open the billing portal when unconfigured", async () => {
    const result = await createBillingPortalSession({
      customerId: "cus_1",
      returnUrl: "https://webind.test/dashboard/settings",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/configured/i);
  });
});

describe("subscription store (real Postgres via PGlite)", () => {
  let userId: string;

  beforeAll(async () => {
    const client = new PGlite();
    const testDb = drizzle(client, { schema });
    __setTestDb(testDb);
    const dir = join(process.cwd(), "drizzle");
    for (const f of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
      await client.exec(readFileSync(join(dir, f), "utf8"));
    }
    const [row] = await testDb
      .insert(schema.users)
      .values({ email: "owner@example.com", passwordHash: "x" })
      .returning();
    userId = row.id;
  }, 60_000);

  it("defaults an unknown user to the free plan", async () => {
    expect(await getSubscription("00000000-0000-0000-0000-000000000000")).toBeNull();
    expect(await getUserPlan("00000000-0000-0000-0000-000000000000")).toBe(DEFAULT_PLAN);
  });

  it("upserts a single row per user and grants the plan when active", async () => {
    await upsertSubscription({
      userId,
      stripeCustomerId: "cus_1",
      stripeSubscriptionId: "sub_1",
      plan: "starter",
      status: "active",
      currentPeriodEnd: new Date("2030-01-01T00:00:00Z"),
    });
    expect(await getUserPlan(userId)).toBe("starter");

    // Second upsert updates in place (unique userId), doesn't duplicate.
    await upsertSubscription({
      userId,
      stripeCustomerId: "cus_1",
      stripeSubscriptionId: "sub_1",
      plan: "growth",
      status: "active",
    });
    const sub = await getSubscription(userId);
    expect(sub?.plan).toBe("growth");
    expect(await getUserPlan(userId)).toBe("growth");
  });

  it("treats a non-active status as free, whatever the plan says", async () => {
    await upsertSubscription({ userId, plan: "growth", status: "canceled" });
    expect(await getUserPlan(userId)).toBe("free");

    await upsertSubscription({ userId, plan: "growth", status: "trialing" });
    expect(await getUserPlan(userId)).toBe("growth");
  });

  it("falls back to free if the stored plan id is unknown", async () => {
    await upsertSubscription({ userId, plan: "enterprise-legacy", status: "active" });
    expect(await getUserPlan(userId)).toBe("free");
  });

  it("quota: free plan's paid features are off-plan and blocked", async () => {
    await upsertSubscription({ userId, plan: "free", status: "inactive" });
    const q = await getQuota(userId, "visibility_probe");
    expect(q.onPlan).toBe(false);
    expect(q.allowed).toBe(false);
  });

  it("quota: starter is metered — usage counts down the remaining allowance", async () => {
    await upsertSubscription({ userId, plan: "starter", status: "active" });
    let q = await getQuota(userId, "visibility_probe");
    expect(q.limit).toBe(50);
    expect(q.remaining).toBe(50);

    await recordUsage(userId, "visibility_probe", 10);
    expect(await usageThisMonth(userId, "visibility_probe")).toBe(10);

    q = await getQuota(userId, "visibility_probe");
    expect(q.used).toBe(10);
    expect(q.remaining).toBe(40);
    expect(q.allowed).toBe(true);
  });

  it("quota: blocks once the monthly cap is reached", async () => {
    await upsertSubscription({ userId, plan: "starter", status: "active" });
    await recordUsage(userId, "fix_generation", 30); // Starter cap
    const q = await getQuota(userId, "fix_generation");
    expect(q.used).toBe(30);
    expect(q.remaining).toBe(0);
    expect(q.allowed).toBe(false);
  });

  it("quota: growth has unlimited fixes (limit -1)", async () => {
    await upsertSubscription({ userId, plan: "growth", status: "active" });
    const q = await getQuota(userId, "fix_generation");
    expect(q.limit).toBe(-1);
    expect(q.remaining).toBe(Infinity);
    expect(q.allowed).toBe(true);
  });

  it("hasActiveSubscription reflects only active/trialing status", async () => {
    await upsertSubscription({ userId, plan: "starter", status: "canceled" });
    expect(await hasActiveSubscription(userId)).toBe(false);
    await upsertSubscription({ userId, plan: "starter", status: "trialing" });
    expect(await hasActiveSubscription(userId)).toBe(true);
  });

  it("upsertSubscription reports the real outcome instead of always succeeding", async () => {
    const applied = await upsertSubscription({ userId, plan: "starter", status: "active" });
    expect(applied).toBe("applied");
  });

  it("an event-ordered write is skipped, not applied, when an equal-or-newer event already landed — Stripe does not guarantee delivery order", async () => {
    const newer = new Date("2030-01-02T00:00:00Z");
    const older = new Date("2030-01-01T00:00:00Z");

    expect(
      await upsertSubscription({
        userId,
        plan: "growth",
        status: "active",
        eventCreatedAt: newer,
      }),
    ).toBe("applied");
    expect(await getUserPlan(userId)).toBe("growth");

    // A delayed/retried older event arrives after the newer one already
    // landed — it must not overwrite the current (correct) state.
    const result = await upsertSubscription({
      userId,
      plan: "starter",
      status: "active",
      eventCreatedAt: older,
    });
    expect(result).toBe("skipped_stale");
    expect(await getUserPlan(userId)).toBe("growth"); // unchanged
  });

  it("a newer event still applies after an older one", async () => {
    const older = new Date("2030-02-01T00:00:00Z");
    const newer = new Date("2030-02-02T00:00:00Z");

    await upsertSubscription({ userId, plan: "starter", status: "active", eventCreatedAt: older });
    expect(
      await upsertSubscription({ userId, plan: "growth", status: "active", eventCreatedAt: newer }),
    ).toBe("applied");
    expect(await getUserPlan(userId)).toBe("growth");
  });

  it("Stripe event ids are recorded once and reported as already-processed on redelivery", async () => {
    expect(await wasStripeEventProcessed("evt_test_1")).toBe(false);
    await markStripeEventProcessed("evt_test_1", "customer.subscription.updated");
    expect(await wasStripeEventProcessed("evt_test_1")).toBe(true);
    // Marking twice (e.g. a race between two redeliveries) must not throw.
    await expect(
      markStripeEventProcessed("evt_test_1", "customer.subscription.updated"),
    ).resolves.toBeUndefined();
  });
});
