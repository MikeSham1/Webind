import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import VisibilityForm from "@/components/VisibilityForm";

export const metadata: Metadata = {
  title: "Keyword Visibility — WeBind",
  robots: { index: false, follow: false, nocache: true },
};

// Anthropic SDK (in the server action) needs Node; auth reads cookies per request.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function VisibilityPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-14">
      <div className="mb-10">
        <Link
          href="/dashboard"
          className="font-mono text-xs uppercase tracking-[0.16em] text-muted hover:text-accent"
        >
          ← Dashboard
        </Link>
        <p className="mt-6 font-mono text-xs uppercase tracking-[0.2em] text-muted">
          Keyword Visibility
        </p>
        <h1 className="mt-2 font-display text-4xl font-semibold text-ink">
          See where AI answers recommend you
        </h1>
        <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-muted">
          Enter the questions your customers actually ask ChatGPT, Gemini, or
          Perplexity. We run each one against the answer engines and show where
          you surface, who gets recommended instead, and how to close the gap.
        </p>
      </div>
      <VisibilityForm />
    </main>
  );
}
