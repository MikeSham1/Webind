import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { constructWebhookEvent } from "@/lib/billing/stripe";
import { upsertSubscription } from "@/lib/billing/store";

export const dynamic = "force-dynamic";

/**
 * Stripe webhook. The event is trusted ONLY after signature verification
 * against STRIPE_WEBHOOK_SECRET — the raw body (not a parsed object) is
 * required for that, so we read request.text() and never request.json().
 * Owner identity always comes from metadata we set at checkout, never from
 * anything the caller could forge.
 */
export async function POST(request: Request) {
  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "Missing signature." }, { status: 400 });
  }

  const payload = await request.text();
  const event = constructWebhookEvent(payload, signature);
  if (!event) {
    // Bad signature, or billing not configured. Reject — never trust the body.
    return NextResponse.json({ error: "Invalid signature." }, { status: 400 });
  }

  try {
    await handleEvent(event);
  } catch (err) {
    console.error("Stripe webhook handling failed:", err);
    // 500 so Stripe retries; the signature was already validated.
    return NextResponse.json({ error: "Handler error." }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}

/** Subscription lifecycle → our single subscription row per user. */
async function handleEvent(event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      await syncSubscription(event.data.object);
      return;
    }
    default:
      // Everything else (invoices, payment intents, etc.) is a no-op for now.
      return;
  }
}

async function syncSubscription(sub: Stripe.Subscription): Promise<void> {
  const userId = sub.metadata?.userId;
  if (!userId) {
    console.warn("Stripe subscription without userId metadata:", sub.id);
    return;
  }
  await upsertSubscription({
    userId,
    stripeCustomerId: typeof sub.customer === "string" ? sub.customer : sub.customer.id,
    stripeSubscriptionId: sub.id,
    plan: sub.metadata?.plan ?? "free",
    // A deleted subscription is canceled regardless of its last known status.
    status: event_isDeleted(sub) ? "canceled" : sub.status,
    currentPeriodEnd: periodEnd(sub),
  });
}

/**
 * A canceled subscription arrives via customer.subscription.deleted with
 * status "canceled"; treat any non-live status as inactive downstream. We key
 * off status here because the event type isn't threaded this deep.
 */
function event_isDeleted(sub: Stripe.Subscription): boolean {
  return sub.status === "canceled" || sub.status === "incomplete_expired";
}

/**
 * Period end moved onto subscription items in recent Stripe API versions; fall
 * back to the top-level field for older shapes. Returns null when unknown.
 */
function periodEnd(sub: Stripe.Subscription): Date | null {
  const itemEnd = sub.items?.data?.[0]?.current_period_end;
  const raw =
    typeof itemEnd === "number"
      ? itemEnd
      : (sub as unknown as { current_period_end?: number }).current_period_end;
  return typeof raw === "number" ? new Date(raw * 1000) : null;
}
