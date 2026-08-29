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
  /** Stripe is in test/sandbox mode — no real charges. */
  testMode?: boolean;
}

/** A single instrument-panel stat: big display value over a mono label. */
function Spec({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex flex-col items-center gap-1 text-center">
      <span className="font-display text-2xl font-semibold leading-none text-ink tabular-nums">
        {value}
      </span>
      <span className="font-mono text-[10px] uppercase leading-tight tracking-[0.14em] text-muted">
        {label}
      </span>
    </div>
  );
}

/** The three metered allowances, read out like the score gauges. */
function specs(plan: Plan): { value: string; label: string }[] {
  const { sites, visibilityPromptsPerMonth: probes, fixGenerationsPerMonth: fixes } = plan.limits;
  return [
    { value: String(sites), label: sites === 1 ? "Site" : "Sites" },
    { value: probes === 0 ? "—" : String(probes), label: "AI probes / mo" },
    { value: fixes === -1 ? "∞" : fixes === 0 ? "—" : String(fixes), label: "Fixes / mo" },
  ];
}

export default function PricingTable({ plans, billingConfigured, signedIn, testMode = false }: Props) {
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
      {testMode && (
        <p className="mx-auto mb-5 max-w-md rounded-full border border-warn/50 bg-warn/10 px-4 py-2 text-center font-mono text-[11px] uppercase tracking-[0.14em] text-warn">
          Sandbox · test mode — no real charges (card 4242 4242 4242 4242)
        </p>
      )}
      <div className="grid items-start gap-4 md:grid-cols-3">
        {plans.map((plan, i) => {
          const paid = Boolean(plan.stripePriceEnv);
          const busy = pending === plan.id;
          const primary = Boolean(plan.highlight);
          return (
            <div
              key={plan.id}
              className={`reveal relative flex h-full flex-col rounded-xl border bg-surface p-6 ${
                plan.highlight
                  ? "scan-frame border-accent md:-mt-2 md:pb-8 md:pt-8"
                  : "border-line"
              }`}
              style={{ animationDelay: `${i * 80}ms` }}
            >
              {/* The two extra scan-frame corners: the recommended plan is the
                  one the instrument is "locked onto". */}
              {plan.highlight && (
                <>
                  <span className="scan-corner-tr" aria-hidden="true" />
                  <span className="scan-corner-bl" aria-hidden="true" />
                </>
              )}

              <div className="flex items-center justify-between gap-3">
                <h2 className="font-display text-lg font-semibold text-ink">{plan.name}</h2>
                {plan.highlight && (
                  <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-accent">
                    <span aria-hidden="true">[ </span>recommended<span aria-hidden="true"> ]</span>
                  </span>
                )}
              </div>

              <div className="mt-4 flex items-baseline gap-1.5">
                <span className="font-display text-5xl font-semibold leading-none tracking-tight text-ink tabular-nums">
                  {plan.priceMonthly === 0 ? "$0" : `$${plan.priceMonthly}`}
                </span>
                <span className="font-mono text-xs uppercase tracking-[0.12em] text-muted">/mo</span>
              </div>
              <p className="mt-3 text-sm leading-relaxed text-muted">{plan.tagline}</p>

              {/* Spec readout — the metered allowances at a glance. */}
              <div className="mt-5 grid grid-cols-3 gap-2 border-y border-line py-4">
                {specs(plan).map((s) => (
                  <Spec key={s.label} value={s.value} label={s.label} />
                ))}
              </div>

              <ul className="mt-5 space-y-2.5 text-sm text-ink">
                {plan.features.map((f) => (
                  <li key={f} className="flex gap-2.5">
                    <span aria-hidden className="mt-[3px] font-mono text-xs text-accent">
                      ✓
                    </span>
                    <span className="leading-relaxed">{f}</span>
                  </li>
                ))}
              </ul>

              <div className="mt-7 pt-1">
                {!paid ? (
                  <Link href="/signup" className={ctaClass(false)}>
                    {plan.cta}
                  </Link>
                ) : !signedIn ? (
                  <Link
                    href={`/signup?next=${encodeURIComponent("/pricing")}`}
                    className={ctaClass(primary)}
                  >
                    {plan.cta}
                  </Link>
                ) : (
                  <button
                    type="button"
                    disabled={!billingConfigured || pending !== null}
                    aria-busy={busy}
                    onClick={() => subscribe(plan)}
                    className={`${ctaClass(primary)} disabled:cursor-not-allowed disabled:opacity-50`}
                  >
                    {busy ? (
                      <span className="inline-flex items-center gap-2">
                        <Spinner primary={primary} />
                        Starting checkout…
                      </span>
                    ) : (
                      plan.cta
                    )}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {error && (
        <p
          role="alert"
          className="mx-auto mt-5 max-w-md rounded-xl border border-bad/40 bg-surface px-4 py-3 text-center text-sm text-ink"
        >
          <span className="font-semibold text-bad">Checkout didn&apos;t start. </span>
          {error}
        </p>
      )}

      {!billingConfigured && (
        <p className="mt-6 text-center font-mono text-[11px] uppercase tracking-[0.16em] text-muted">
          <span aria-hidden="true">[ </span>
          Paid plans open at launch — start free today
          <span aria-hidden="true"> ]</span>
        </p>
      )}
    </div>
  );
}

/** Shared CTA shape — a full pill, accent-filled for the primary plan. */
function ctaClass(primary: boolean): string {
  const base =
    "block w-full rounded-full px-5 py-3 text-center font-sans text-sm font-semibold transition-colors";
  return primary
    ? `${base} bg-accent text-accent-ink hover:bg-accent-hover`
    : `${base} border border-line text-ink hover:border-accent hover:text-accent`;
}

function Spinner({ primary }: { primary: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`h-4 w-4 animate-spin rounded-full border-2 ${
        primary
          ? "border-accent-ink/40 border-t-accent-ink"
          : "border-accent/40 border-t-accent"
      }`}
    />
  );
}
