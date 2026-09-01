import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { isBillingConfigured, stripeMode } from "@/lib/billing/stripe";
import { isSerperConfigured } from "@/lib/benchmark/serper";
import { isPsiConfigured } from "@/lib/vitals/psi";

export const dynamic = "force-dynamic";

/** True when the env var is set to a non-empty value. Never returns the value. */
function isSet(name: string): boolean {
  return Boolean(process.env[name]);
}

/**
 * Admin-only integration health: which external services the running instance
 * detects as configured. Booleans (and the Stripe mode) ONLY — never the keys
 * themselves. Useful for confirming Railway variables landed on the right
 * service without pasting secrets anywhere. 404 for non-admins so the endpoint
 * doesn't even reveal itself.
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user?.isAdmin) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({
    // Required to run at all.
    core: {
      database: getDb() !== null,
      sitePassword: isSet("SITE_PASSWORD"),
    },
    // Model providers powering reports, suggestions, the writer, and the audit.
    ai: {
      gemini: isSet("GEMINI_API_KEY"),
      anthropic: isSet("ANTHROPIC_API_KEY"),
    },
    // Gated features that need their own key.
    benchmark: { serper: isSerperConfigured() },
    coreWebVitals: { psi: isPsiConfigured() },
    // Payments. `mode` is derived from the key prefix (test = sandbox), not secret.
    stripe: {
      configured: isBillingConfigured(),
      mode: stripeMode(),
      webhookSecret: isSet("STRIPE_WEBHOOK_SECRET"),
      priceStarter: isSet("STRIPE_PRICE_STARTER"),
      priceGrowth: isSet("STRIPE_PRICE_GROWTH"),
    },
    // Optional / secondary.
    email: { resend: isSet("RESEND_API_KEY") },
    contentWriter: { tunedVertexEndpoint: isSet("CONTENT_WRITER_VERTEX_ENDPOINT") },
    visibilityStubs: {
      openai: isSet("OPENAI_API_KEY"),
      perplexity: isSet("PERPLEXITY_API_KEY"),
      serpapi: isSet("SERPAPI_API_KEY"),
    },
  });
}
