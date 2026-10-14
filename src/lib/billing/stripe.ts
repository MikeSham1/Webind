import Stripe from "stripe";
import type { Plan } from "./plans";
import { stripePriceId } from "./plans";

/**
 * Stripe client + helpers. Billing is OPTIONAL: with no STRIPE_SECRET_KEY the
 * app runs normally (pricing page shows, CTAs point to signup), it just can't
 * take payments — the same honest degrade pattern the rest of WeBind uses.
 * Nothing here is constructed at module load, so tests and unconfigured
 * deploys never touch Stripe.
 */

let cached: Stripe | null | undefined;

function getStripe(): Stripe | null {
  if (cached !== undefined) return cached;
  const key = process.env.STRIPE_SECRET_KEY;
  cached = key ? new Stripe(key) : null;
  return cached;
}

export function isBillingConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

/**
 * Which Stripe environment the keys point at. Test-mode (sandbox) keys are
 * `sk_test_` / `rk_test_`; live keys are `sk_live_` / `rk_live_`. Anything set
 * that isn't clearly live is treated as test — the safe default. Surfaced in
 * the UI so a sandbox checkout is never mistaken for a real charge.
 */
export function stripeMode(): "test" | "live" | "off" {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return "off";
  return key.startsWith("sk_live_") || key.startsWith("rk_live_") ? "live" : "test";
}

export type CheckoutResult =
  | { ok: true; url: string }
  | { ok: false; error: string };

/**
 * Create a Stripe Checkout session for a plan and return its URL. Owner data
 * (userId) rides on client_reference_id + metadata so the webhook can attribute
 * the resulting subscription. A 14-day trial matches the plan CTA copy.
 */
export async function createCheckoutSession(input: {
  userId: string;
  email: string;
  plan: Plan;
  baseUrl: string;
  existingCustomerId?: string | null;
}): Promise<CheckoutResult> {
  const stripe = getStripe();
  if (!stripe) return { ok: false, error: "Billing isn't configured yet." };

  const price = stripePriceId(input.plan);
  if (!price) {
    return { ok: false, error: `No Stripe price configured for the ${input.plan.name} plan.` };
  }

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price, quantity: 1 }],
      client_reference_id: input.userId,
      ...(input.existingCustomerId
        ? { customer: input.existingCustomerId }
        : { customer_email: input.email }),
      subscription_data: {
        // Only a genuinely new Stripe customer gets a trial — an existing
        // customer id means they've subscribed before (even if since
        // canceled), and every checkout previously granted a fresh 14-day
        // trial regardless of history.
        ...(input.existingCustomerId ? {} : { trial_period_days: 14 }),
        metadata: { userId: input.userId, plan: input.plan.id },
      },
      metadata: { userId: input.userId, plan: input.plan.id },
      success_url: `${input.baseUrl}/dashboard/settings?billing=success`,
      cancel_url: `${input.baseUrl}/pricing?billing=cancelled`,
      allow_promotion_codes: true,
    });
    return session.url
      ? { ok: true, url: session.url }
      : { ok: false, error: "Stripe did not return a checkout URL." };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Checkout failed." };
  }
}

/**
 * Create a Stripe Billing Portal session so a customer can update, upgrade, or
 * cancel their subscription and payment method on Stripe's hosted page. Returns
 * the URL, or an error when billing isn't configured or the customer is unknown.
 */
export async function createBillingPortalSession(input: {
  customerId: string;
  returnUrl: string;
}): Promise<CheckoutResult> {
  const stripe = getStripe();
  if (!stripe) return { ok: false, error: "Billing isn't configured yet." };
  try {
    // A portal configuration made through the API (scripts/billing/setup-stripe.ts)
    // isn't the account default, so name it; without the env var, Stripe uses
    // the default one saved in the dashboard.
    const configuration = process.env.STRIPE_PORTAL_CONFIGURATION?.trim() || undefined;
    const session = await stripe.billingPortal.sessions.create({
      customer: input.customerId,
      return_url: input.returnUrl,
      ...(configuration ? { configuration } : {}),
    });
    return session.url
      ? { ok: true, url: session.url }
      : { ok: false, error: "Stripe did not return a portal URL." };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Couldn't open the billing portal." };
  }
}

/**
 * Cancel a subscription immediately (not "at period end") — used only when
 * the local account owning it is being deleted, so continuing to bill them
 * after they can no longer log in or reach the billing portal would be
 * indefensible. Returns ok even if Stripe already considers it canceled
 * (deleting an already-canceled subscription 404s on Stripe's side in some
 * API versions; that's not a failure from the caller's point of view).
 */
export async function cancelSubscription(
  subscriptionId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const stripe = getStripe();
  if (!stripe) return { ok: false, error: "Billing isn't configured yet." };
  try {
    await stripe.subscriptions.cancel(subscriptionId);
    return { ok: true };
  } catch (err) {
    if (err instanceof Stripe.errors.StripeInvalidRequestError && err.code === "resource_missing") {
      return { ok: true }; // already gone — nothing left to cancel
    }
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Couldn't cancel the subscription.",
    };
  }
}

/**
 * Verify a webhook payload's signature and return the event, or null if the
 * signature/secret is missing or invalid (the route must reject on null).
 */
export function constructWebhookEvent(payload: string, signature: string): Stripe.Event | null {
  const stripe = getStripe();
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!stripe || !secret) return null;
  try {
    return stripe.webhooks.constructEvent(payload, signature, secret);
  } catch {
    return null;
  }
}
