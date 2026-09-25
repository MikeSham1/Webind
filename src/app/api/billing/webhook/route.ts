import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { constructWebhookEvent } from "@/lib/billing/stripe";
import { planIdForPrice } from "@/lib/billing/plans";
import {
  markStripeEventProcessed,
  upsertSubscription,
  wasStripeEventProcessed,
} from "@/lib/billing/store";

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

  // Idempotency: Stripe retries on anything but a 2xx, and can also just
  // duplicate-deliver. Re-processing an already-applied event is at best
  // redundant and at worst (combined with event ordering) a no-op we don't
  // need to repeat — ack it without touching state again.
  if (await wasStripeEventProcessed(event.id)) {
    return NextResponse.json({ received: true, duplicate: true });
  }

  try {
    const ok = await handleEvent(event);
    if (!ok) {
      // The write genuinely failed (DB error, etc.) — do NOT acknowledge.
      // Returning 200 here previously left Stripe believing a subscription
      // change was recorded when it silently wasn't.
      return NextResponse.json({ error: "Persistence failed." }, { status: 500 });
    }
  } catch (err) {
    console.error("Stripe webhook handling failed:", err);
    // 500 so Stripe retries; the signature was already validated.
    return NextResponse.json({ error: "Handler error." }, { status: 500 });
  }

  // Only reached once the write actually succeeded (or was a deliberate,
  // safe no-op) — never marked processed on a path that should be retried.
  await markStripeEventProcessed(event.id, event.type);
  return NextResponse.json({ received: true });
}

/** Subscription lifecycle → our single subscription row per user. Returns false iff persistence failed and the event must NOT be acknowledged. */
async function handleEvent(event: Stripe.Event): Promise<boolean> {
  switch (event.type) {
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      return syncSubscription(event.data.object, event.created);
    }
    default:
      // Everything else (invoices, payment intents, etc.) is a no-op for now.
      return true;
  }
}

async function syncSubscription(sub: Stripe.Subscription, eventCreated: number): Promise<boolean> {
  const userId = sub.metadata?.userId;
  if (!userId) {
    console.warn("Stripe subscription without userId metadata:", sub.id);
    return true; // Nothing we can attribute this to — not a persistence failure.
  }
  const result = await upsertSubscription({
    userId,
    stripeCustomerId: typeof sub.customer === "string" ? sub.customer : sub.customer.id,
    stripeSubscriptionId: sub.id,
    // The subscription's actual current price is the source of truth for
    // plan — checkout-time metadata is never updated when a customer changes
    // plans through the billing portal, so it can silently go stale. Only
    // fall back to metadata when no recognized price is on the subscription
    // (shouldn't normally happen).
    plan: planIdForPrice(sub.items?.data?.[0]?.price?.id ?? "") ?? sub.metadata?.plan ?? "free",
    // A deleted subscription is canceled regardless of its last known status.
    status: event_isDeleted(sub) ? "canceled" : sub.status,
    currentPeriodEnd: periodEnd(sub),
    eventCreatedAt: new Date(eventCreated * 1000),
  });
  return result !== "failed";
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
