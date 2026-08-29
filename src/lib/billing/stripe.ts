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
        trial_period_days: 14,
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
    const session = await stripe.billingPortal.sessions.create({
      customer: input.customerId,
      return_url: input.returnUrl,
    });
    return session.url
      ? { ok: true, url: session.url }
      : { ok: false, error: "Stripe did not return a portal URL." };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Couldn't open the billing portal." };
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
