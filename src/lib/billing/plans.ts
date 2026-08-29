/**
 * Pricing plans.
 *
 * Priced to undercut the 2026 AI-visibility field (Otterly $29+, Peec €89+,
 * AthenaHQ $295, Profound $399+, Semrush AI toolkit $99, Writesonic $79) while
 * bundling what pure trackers don't have: the evidence-grounded Fix Generator
 * and one-click WordPress/GitHub apply — diagnose AND fix, not just monitor.
 *
 * These are public marketing/config values (no secrets). The Stripe price id
 * for each paid plan is read from an env var at request time.
 */

export type PlanId = "free" | "starter" | "growth";

export interface Plan {
  id: PlanId;
  name: string;
  /** USD per month, billed monthly. 0 for free. */
  priceMonthly: number;
  tagline: string;
  features: string[];
  limits: {
    sites: number;
    /** Keyword Visibility probes per month across engines. */
    visibilityPromptsPerMonth: number;
    /** Grounded Fix Generator candidates per month. -1 = unlimited. */
    fixGenerationsPerMonth: number;
  };
  /** Env var holding this plan's Stripe Price id. null for the free plan. */
  stripePriceEnv: string | null;
  cta: string;
  highlight?: boolean;
}

export const PLANS: Plan[] = [
  {
    id: "free",
    name: "Free",
    priceMonthly: 0,
    tagline: "See where you stand — forever free.",
    features: [
      "Unlimited AI-readiness reports",
      "AI Readiness + Traditional Authority scores",
      "The full visibility-pipeline stage vector",
      "Prioritized, ranked fixes",
    ],
    limits: { sites: 1, visibilityPromptsPerMonth: 0, fixGenerationsPerMonth: 0 },
    stripePriceEnv: null,
    cta: "Start free",
  },
  {
    id: "starter",
    name: "Starter",
    priceMonthly: 19,
    tagline: "Diagnose, fix, and track one site — under everyone else.",
    features: [
      "Everything in Free",
      "Keyword Visibility — 50 AI probes / month",
      "Fix Generator — 30 grounded fixes / month, with review",
      "One-click apply to WordPress & GitHub",
      "Saved report history + score trends",
    ],
    limits: { sites: 1, visibilityPromptsPerMonth: 50, fixGenerationsPerMonth: 30 },
    stripePriceEnv: "STRIPE_PRICE_STARTER",
    cta: "Start 14-day trial",
    highlight: true,
  },
  {
    id: "growth",
    name: "Growth",
    priceMonthly: 79,
    tagline: "Multiple sites and unlimited fixes for growing teams.",
    features: [
      "Everything in Starter",
      "Up to 5 sites",
      "Keyword Visibility — 250 AI probes / month",
      "Unlimited grounded fixes",
      "All answer engines as they light up",
      "Priority fix generation",
    ],
    limits: { sites: 5, visibilityPromptsPerMonth: 250, fixGenerationsPerMonth: -1 },
    stripePriceEnv: "STRIPE_PRICE_GROWTH",
    cta: "Start 14-day trial",
  },
];

export function planById(id: string): Plan | undefined {
  return PLANS.find((p) => p.id === id);
}

/** The configured Stripe Price id for a plan, or undefined (free / not set). */
export function stripePriceId(plan: Plan): string | undefined {
  if (!plan.stripePriceEnv) return undefined;
  return process.env[plan.stripePriceEnv] || undefined;
}

/**
 * Whether a plan unlocks the detailed, page-grounded fix suggestions in the
 * report (the Fix Generator). Free (0/month) does not; Starter and up do. Used
 * to paywall the suggestions on the report.
 */
export function planAllowsSuggestions(id: string): boolean {
  return (planById(id)?.limits.fixGenerationsPerMonth ?? 0) !== 0;
}

/** The default plan for a user with no active subscription. */
export const DEFAULT_PLAN: PlanId = "free";
