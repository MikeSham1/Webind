"use client";

import { useState } from "react";
import Link from "next/link";

interface Props {
  planName: string;
  /** Subscription status (active, trialing, canceled, inactive…). */
  status: string;
  /** True when the user has a Stripe customer — i.e. can open the portal. */
  hasCustomer: boolean;
  /** True when Stripe keys are configured on the server. */
  billingConfigured: boolean;
}

const STATUS_LABEL: Record<string, string> = {
  active: "Active",
  trialing: "Trial",
  past_due: "Past due",
  canceled: "Canceled",
  incomplete: "Incomplete",
  inactive: "—",
};

export default function BillingSection({ planName, status, hasCustomer, billingConfigured }: Props) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function openPortal() {
    setError(null);
    setPending(true);
    try {
      const res = await fetch("/api/billing/portal", { method: "POST" });
      const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
      if (res.ok && data.url) {
        window.location.assign(data.url);
        return;
      }
      setError(data.error ?? "Couldn't open the billing portal.");
    } catch {
      setError("Couldn't reach billing. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="rounded-xl border border-line bg-surface p-5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-sans text-sm font-semibold text-ink">Current plan</span>
        <span className="font-mono text-xs text-muted">
          {STATUS_LABEL[status] ?? status}
        </span>
      </div>
      <p className="mt-1 font-display text-2xl font-semibold text-ink">{planName}</p>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        {hasCustomer && billingConfigured ? (
          <button
            type="button"
            onClick={openPortal}
            disabled={pending}
            className="inline-flex h-10 items-center justify-center rounded-full bg-accent px-5 font-sans text-sm font-semibold text-accent-ink transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
          >
            {pending ? "Opening…" : "Manage billing"}
          </button>
        ) : (
          <Link
            href="/pricing"
            className="inline-flex h-10 items-center justify-center rounded-full bg-accent px-5 font-sans text-sm font-semibold text-accent-ink transition-colors hover:bg-accent-hover"
          >
            See plans
          </Link>
        )}
        <Link
          href="/pricing"
          className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted hover:text-accent"
        >
          Compare plans
        </Link>
      </div>

      {error && <p role="alert" className="mt-3 text-sm text-bad">{error}</p>}

      {!billingConfigured && (
        <p className="mt-3 font-mono text-[11px] uppercase tracking-[0.14em] text-muted">
          Paid plans open at launch.
        </p>
      )}
    </div>
  );
}
