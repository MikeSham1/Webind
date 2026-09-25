import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { planById } from "@/lib/billing/plans";
import { createCheckoutSession, isBillingConfigured } from "@/lib/billing/stripe";
import { getSubscription, hasActiveSubscription } from "@/lib/billing/store";

export const dynamic = "force-dynamic";

/**
 * Start a Stripe Checkout session for the signed-in owner. The plan comes from
 * the request; the user identity comes from the session cookie (never the
 * body) so a caller can only ever buy for themselves. Returns the hosted
 * checkout URL for the client to redirect to.
 */
export async function POST(request: Request) {
  if (!isBillingConfigured()) {
    return NextResponse.json({ error: "Billing isn't available yet." }, { status: 503 });
  }

  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in to subscribe." }, { status: 401 });
  }

  let planId: unknown;
  try {
    planId = (await request.json())?.plan;
  } catch {
    planId = undefined;
  }
  const plan = typeof planId === "string" ? planById(planId) : undefined;
  if (!plan || !plan.stripePriceEnv) {
    return NextResponse.json({ error: "Unknown or non-purchasable plan." }, { status: 400 });
  }

  // An already-subscribed user changes plans through the billing portal
  // (which prorates/schedules correctly), never by starting a second
  // checkout — that created a second Stripe subscription for the same
  // customer instead of touching the existing one.
  if (await hasActiveSubscription(user.id)) {
    return NextResponse.json(
      { error: "You already have an active plan. Manage it from Settings instead." },
      { status: 409 },
    );
  }

  const existing = await getSubscription(user.id);
  const origin = new URL(request.url).origin;

  const result = await createCheckoutSession({
    userId: user.id,
    email: user.email,
    plan,
    baseUrl: origin,
    existingCustomerId: existing?.stripeCustomerId,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 502 });
  }
  return NextResponse.json({ url: result.url });
}
