import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/lib/db/schema";
import { __setTestDb } from "@/lib/db";
import { DEFAULT_PLAN, PLANS, planById, stripePriceId } from "./plans";
import { getSubscription, getUserPlan, upsertSubscription } from "./store";
import { constructWebhookEvent, createCheckoutSession, isBillingConfigured } from "./stripe";

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
});
