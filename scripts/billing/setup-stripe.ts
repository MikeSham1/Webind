/**
 * Create (or find) everything WebInd's billing needs in a Stripe account, then
 * print the env lines to paste into .env.local. Safe to re-run: prices are
 * found again by lookup key, so a second run creates nothing new.
 *
 *   npm run billing:setup            # test mode (sk_test_ key) — the default
 *   npm run billing:setup -- --live  # live mode, only when you mean it
 *
 * Reads STRIPE_SECRET_KEY from .env.local. Plan names and monthly prices come
 * from src/lib/billing/plans.ts, so the app and Stripe can't disagree. If a
 * plan's price changes there, re-running creates the new price and moves the
 * lookup key to it; existing subscribers keep the price they signed up at.
 */
import { loadEnvConfig } from "@next/env";
import Stripe from "stripe";
import { PLANS, type Plan } from "../../src/lib/billing/plans";

loadEnvConfig(process.cwd());

const LIVE_FLAG = process.argv.includes("--live");
/** Marks the portal configuration this script owns, so re-runs reuse it. */
const PORTAL_MARKER = "webind_setup";

function lookupKey(plan: Plan): string {
  return `webind_${plan.id}_monthly`;
}

async function ensurePrice(stripe: Stripe, plan: Plan): Promise<Stripe.Price> {
  const amount = plan.priceMonthly * 100; // cents
  const key = lookupKey(plan);
  const [existing] = (
    await stripe.prices.list({ lookup_keys: [key], active: true, limit: 1 })
  ).data;

  if (
    existing &&
    existing.unit_amount === amount &&
    existing.currency === "usd" &&
    existing.recurring?.interval === "month"
  ) {
    console.log(`  ✓ ${plan.name}: found $${plan.priceMonthly}/month (${existing.id})`);
    return existing;
  }

  // Reuse the plan's product when a price already exists, so Stripe shows one
  // "WebInd Starter" product with its price history, not a new product per run.
  const product = existing
    ? (existing.product as string)
    : (
        await stripe.products.create({
          name: `WebInd ${plan.name}`,
          description: plan.tagline,
          metadata: { webind_plan: plan.id },
        })
      ).id;

  const price = await stripe.prices.create({
    product,
    currency: "usd",
    unit_amount: amount,
    recurring: { interval: "month" },
    lookup_key: key,
    // Moves the key off an old price whose amount no longer matches plans.ts.
    transfer_lookup_key: true,
    metadata: { webind_plan: plan.id },
  });
  console.log(
    existing
      ? `  ↻ ${plan.name}: price changed, created $${plan.priceMonthly}/month (${price.id})`
      : `  + ${plan.name}: created $${plan.priceMonthly}/month (${price.id})`,
  );
  return price;
}

/**
 * The hosted page where subscribers update their card, see invoices, switch
 * between paid plans, or cancel (at the end of the period they paid for).
 */
async function ensurePortal(
  stripe: Stripe,
  prices: Stripe.Price[],
): Promise<Stripe.BillingPortal.Configuration> {
  const products = prices.map((p) => ({
    product: p.product as string,
    prices: [p.id],
  }));
  const features: Stripe.BillingPortal.ConfigurationCreateParams.Features = {
    customer_update: { enabled: true, allowed_updates: ["email", "address"] },
    invoice_history: { enabled: true },
    payment_method_update: { enabled: true },
    subscription_cancel: { enabled: true, mode: "at_period_end" },
    subscription_update: {
      enabled: true,
      default_allowed_updates: ["price"],
      products,
      proration_behavior: "create_prorations",
    },
  };

  const configs = await stripe.billingPortal.configurations.list({ active: true, limit: 100 });
  const mine = configs.data.find((c) => c.metadata?.[PORTAL_MARKER] === "1");
  if (mine) {
    // Update in place so plan/price changes reach the portal too.
    const updated = await stripe.billingPortal.configurations.update(mine.id, { features });
    console.log(`  ✓ Customer portal: updated (${updated.id})`);
    return updated;
  }
  const created = await stripe.billingPortal.configurations.create({
    features,
    business_profile: { headline: "Manage your WebInd subscription" },
    metadata: { [PORTAL_MARKER]: "1" },
  });
  console.log(`  + Customer portal: created (${created.id})`);
  return created;
}

async function main(): Promise<number> {
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  if (!key) {
    console.error(
      "STRIPE_SECRET_KEY isn't set.\n" +
        "Get a test key from https://dashboard.stripe.com/test/apikeys (it starts with sk_test_)\n" +
        "and add it to .env.local as:  STRIPE_SECRET_KEY=sk_test_...",
    );
    return 2;
  }
  const live = key.startsWith("sk_live_") || key.startsWith("rk_live_");
  if (live && !LIVE_FLAG) {
    console.error(
      "That's a LIVE key: these products would be real and could charge real cards.\n" +
        "Use a test key (sk_test_...) while setting up, or pass --live if you mean it.",
    );
    return 2;
  }

  const stripe = new Stripe(key);
  console.log(`Setting up WebInd billing in Stripe ${live ? "LIVE" : "test"} mode…`);

  const paidPlans = PLANS.filter((p) => p.stripePriceEnv);
  const prices: Stripe.Price[] = [];
  for (const plan of paidPlans) prices.push(await ensurePrice(stripe, plan));
  const portal = await ensurePortal(stripe, prices);

  console.log("\nAdd these lines to .env.local (replace any older ones):\n");
  paidPlans.forEach((plan, i) => console.log(`${plan.stripePriceEnv}=${prices[i].id}`));
  console.log(`STRIPE_PORTAL_CONFIGURATION=${portal.id}`);
  console.log(
    "\nStill needed: STRIPE_WEBHOOK_SECRET. For local testing it comes from\n" +
      "  stripe listen --forward-to localhost:3000/api/billing/webhook\n" +
      "(the whsec_... value it prints when it starts).",
  );
  return 0;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Stripe setup failed: ${msg}`);
    process.exitCode = 1;
  },
);
