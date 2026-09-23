import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { isBillingConfigured, stripeMode } from "@/lib/billing/stripe";
import { isSerperConfigured } from "@/lib/benchmark/serper";
import { isPsiConfigured } from "@/lib/vitals/psi";
import { generate } from "@/lib/ai/generator";
import { gemini37Provider, geminiKeyDiagnostics, geminiModelId } from "@/lib/ai/gemini";

export const dynamic = "force-dynamic";

/** True when the env var is set to a non-empty value. Never returns the value. */
function isSet(name: string): boolean {
  return Boolean(process.env[name]);
}

/**
 * Actually call Gemini once, cheaply, and report what happened.
 *
 * "Is the variable set" and "does the key work" are different questions, and
 * only the second one explains a planner that answers "unavailable". A key can
 * be present but revoked, billing-disabled, quota-exhausted, scoped to another
 * Google project, or malformed by its paste — all of which look identical from
 * outside. This returns the provider's own error text, which names the cause.
 */
async function probeGemini() {
  const startedAt = Date.now();
  const result = await generate(
    {
      system: "Reply with the single word: ok",
      prompt: "Reply with the single word: ok",
      // Enough headroom that reasoning alone can't starve the reply and make a
      // working key look broken — the exact failure this probe exists to rule out.
      maxOutputTokens: 512,
      thinkingLevel: "minimal",
      purpose: "health_probe",
    },
    { provider: gemini37Provider() },
  );

  return {
    ok: !result.fallback && result.text.trim().length > 0,
    model: result.model,
    // Present only on failure; this is the provider's message, not the key.
    error: result.error ?? null,
    finishReason: result.finishReason ?? null,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    thinkingTokens: result.thinkingTokens ?? 0,
    durationMs: Date.now() - startedAt,
  };
}

/**
 * Admin-only integration health: which external services the running instance
 * detects as configured. Booleans (and the Stripe mode) ONLY — never the keys
 * themselves. Useful for confirming Railway variables landed on the right
 * service without pasting secrets anywhere. 404 for non-admins so the endpoint
 * doesn't even reveal itself.
 */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user?.isAdmin) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Opt-in, because it spends a real (tiny) API call: /api/health/integrations?probe=gemini
  const probe = new URL(request.url).searchParams.get("probe");
  const geminiProbe = probe === "gemini" || probe === "1" ? await probeGemini() : null;

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
      // Shape of the Gemini key after normalization — structure only, no secret.
      // hadSurroundingQuotes / hadEdgeWhitespace being true means the stored
      // value is dirty: it works now because we clean it, but fix it upstream.
      geminiKey: geminiKeyDiagnostics(),
      geminiModel: geminiModelId(),
      // null unless ?probe=gemini was passed.
      geminiProbe,
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
