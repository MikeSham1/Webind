"use client";

import { useState } from "react";
import Link from "next/link";
import type { Plan } from "@/lib/billing/plans";

interface Props {
  plans: Plan[];
  /** Stripe is wired up and can take payments. */
  billingConfigured: boolean;
  /** Someone is signed in — paid CTAs can go straight to checkout. */
  signedIn: boolean;
}

function price(plan: Plan): string {
  return plan.priceMonthly === 0 ? "$0" : `$${plan.priceMonthly}`;
}

export default function PricingTable({ plans, billingConfigured, signedIn }: Props) {
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function subscribe(plan: Plan) {
    setError(null);
    setPending(plan.id);
    try {
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ plan: plan.id }),
      });
      const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
      if (res.ok && data.url) {
        window.location.assign(data.url);
        return;
      }
      setError(data.error ?? "Couldn't start checkout. Please try again.");
    } catch {
      setError("Couldn't reach checkout. Please try again.");
    } finally {
      setPending((cur) => (cur === plan.id ? null : cur));
    }
  }

  return (
    <div>
      <div className="grid gap-4 md:grid-cols-3">
        {plans.map((plan) => {
          const paid = Boolean(plan.stripePriceEnv);
          return (
            <div
              key={plan.id}
              className={`flex flex-col rounded-2xl border p-6 ${
                plan.highlight
                  ? "border-accent bg-surface shadow-sm"
                  : "border-line bg-surface"
              }`}
            >
              <div className="flex items-center justify-between">
                <h2 className="font-display text-lg font-semibold text-ink">{plan.name}</h2>
                {plan.highlight && (
                  <span className="rounded-full bg-accent/10 px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-accent">
                    Most popular
                  </span>
                )}
              </div>

              <div className="mt-4 flex items-baseline gap-1">
                <span className="font-display text-4xl font-semibold text-ink">{price(plan)}</span>
                <span className="font-mono text-xs text-muted">/mo</span>
              </div>
              <p className="mt-2 text-sm leading-relaxed text-muted">{plan.tagline}</p>

              <ul className="mt-5 space-y-2 text-sm text-ink">
                {plan.features.map((f) => (
                  <li key={f} className="flex gap-2">
                    <span aria-hidden className="mt-0.5 text-accent">
                      ✓
                    </span>
                    <span className="leading-relaxed">{f}</span>
                  </li>
                ))}
              </ul>

              <div className="mt-6 pt-2">
                {!paid ? (
                  <Link
                    href="/signup"
                    className="block w-full rounded-lg border border-line bg-paper px-4 py-2.5 text-center text-sm font-semibold text-ink transition hover:border-accent hover:text-accent"
                  >
                    {plan.cta}
                  </Link>
                ) : !signedIn ? (
                  <Link
                    href={`/signup?next=${encodeURIComponent("/pricing")}`}
                    className={`block w-full rounded-lg px-4 py-2.5 text-center text-sm font-semibold transition ${
                      plan.highlight
                        ? "bg-accent text-white hover:opacity-90"
                        : "border border-line bg-paper text-ink hover:border-accent hover:text-accent"
                    }`}
                  >
                    {plan.cta}
                  </Link>
                ) : (
                  <button
                    type="button"
                    disabled={!billingConfigured || pending !== null}
                    onClick={() => subscribe(plan)}
                    className={`w-full rounded-lg px-4 py-2.5 text-center text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${
                      plan.highlight
                        ? "bg-accent text-white hover:opacity-90"
                        : "border border-line bg-paper text-ink hover:border-accent hover:text-accent"
                    }`}
                  >
                    {pending === plan.id ? "Starting checkout…" : plan.cta}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {error && <p className="mt-4 text-center text-sm text-red-600">{error}</p>}

      {!billingConfigured && (
        <p className="mt-6 text-center font-mono text-xs uppercase tracking-[0.14em] text-muted">
          Paid plans open at launch — start free today.
        </p>
      )}
    </div>
  );
}
