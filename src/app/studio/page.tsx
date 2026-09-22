import type { Metadata } from "next";
import StudioForm from "@/components/StudioForm";
import ContentPlanner from "@/components/ContentPlanner";
import SiteContextBar from "@/components/SiteContextBar";
import SiteHeader from "@/components/SiteHeader";
import { getCurrentUser } from "@/lib/auth";
import { getWordPressConnectionStatus } from "@/lib/integrations/connections";

export const metadata: Metadata = {
  title: "Content Studio — WeBind Design",
  robots: { index: false, follow: false, nocache: true },
};

export const dynamic = "force-dynamic";

/** A numbered step marker, so the two halves read as one flow. */
function StepLabel({ n, title }: { n: number; title: string }) {
  return (
    <div className="mb-3 flex items-center gap-2.5">
      <span
        aria-hidden="true"
        className="flex h-6 w-6 items-center justify-center rounded-full bg-accent font-sans text-xs font-semibold text-accent-ink"
      >
        {n}
      </span>
      <span className="font-sans text-sm font-semibold text-ink">{title}</span>
    </div>
  );
}

export default async function StudioPage() {
  const user = await getCurrentUser();
  const wordPressConnected = user
    ? (await getWordPressConnectionStatus(user.id)) !== null
    : false;

  return (
    <div className="flex min-h-full flex-col">
      <SiteHeader />
      <main className="mx-auto w-full max-w-3xl flex-1 px-6 pb-20">
        {/* Greeting + what this place is for */}
        <div className="reveal">
          <p className="font-sans text-sm font-medium text-accent">Content Studio</p>
          <h1 className="mt-2 font-display text-4xl font-semibold tracking-tight text-ink sm:text-5xl">
            {user ? "What should we write today?" : "Build content AI will cite"}
          </h1>
          <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-muted">
            Think it through with AI, then turn the brief into a draft grounded{" "}
            <em>only</em> in facts you provide. Every draft is safety-checked and
            waits for your approval — nothing publishes on its own.
          </p>
        </div>

        <div className="reveal mt-6" style={{ animationDelay: "60ms" }}>
          <SiteContextBar userId={user?.id ?? null} />
        </div>

        {/* Step 1 — the conversation */}
        <div className="reveal mt-10" style={{ animationDelay: "120ms" }}>
          <StepLabel n={1} title="Plan" />
          <ContentPlanner />
        </div>

        {/* Step 2 — the grounded draft */}
        <div className="reveal mt-12" style={{ animationDelay: "180ms" }}>
          <StepLabel n={2} title="Draft" />
          <StudioForm wordPressConnected={wordPressConnected} />
        </div>
      </main>
    </div>
  );
}
