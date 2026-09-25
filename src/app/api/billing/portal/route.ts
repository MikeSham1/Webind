import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getBaseUrl } from "@/lib/baseUrl";
import { createBillingPortalSession, isBillingConfigured } from "@/lib/billing/stripe";
import { getSubscription } from "@/lib/billing/store";

export const dynamic = "force-dynamic";

/**
 * Open the Stripe Billing Portal for the signed-in owner. The Stripe customer
 * comes from their stored subscription (never the request body), so a caller
 * can only ever manage their own billing. 400 when they have no customer yet
 * (they haven't subscribed) — the UI shows an upgrade CTA instead.
 */
export async function POST() {
  if (!isBillingConfigured()) {
    return NextResponse.json({ error: "Billing isn't available yet." }, { status: 503 });
  }

  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in to manage billing." }, { status: 401 });
  }

  const subscription = await getSubscription(user.id);
  if (!subscription?.stripeCustomerId) {
    return NextResponse.json({ error: "No billing account yet — subscribe first." }, { status: 400 });
  }

  const result = await createBillingPortalSession({
    customerId: subscription.stripeCustomerId,
    returnUrl: `${await getBaseUrl()}/dashboard/settings`,
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 502 });
  }
  return NextResponse.json({ url: result.url });
}
