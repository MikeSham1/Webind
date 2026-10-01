import type { Metadata } from "next";
import StudioWorkspace from "@/components/StudioWorkspace";
import SiteContextBar from "@/components/SiteContextBar";
import SiteHeader from "@/components/SiteHeader";
import { getCurrentUser } from "@/lib/auth";
import { getWordPressConnectionStatus } from "@/lib/integrations/connections";
import { resolveActiveSite } from "@/lib/sites/store";
import { getPlannerConversation } from "@/lib/content/planner-store";

export const metadata: Metadata = {
  title: "Content Studio — WeBind Design",
};

export const dynamic = "force-dynamic";

export default async function StudioPage() {
  const user = await getCurrentUser();
  // Resolved once and reused for both calls below — the planner conversation
  // is scoped per-site (see planner-store.ts), so loading it needs to know
  // which site the user is currently on, same as the WordPress connection
  // doesn't but the chat history does.
  const activeSite = user ? await resolveActiveSite(user.id) : null;
  const [wpConnection, plannerMessages] = await Promise.all([
    user ? getWordPressConnectionStatus(user.id) : Promise.resolve(null),
    user ? getPlannerConversation(user.id, activeSite?.id ?? null) : Promise.resolve([]),
  ]);

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
            Think it through with AI, turn the conversation into a brief, and
            draft a page grounded <em>only</em> in facts you provide. Every draft
            is safety-checked and waits for your approval — nothing publishes on
            its own.
          </p>
        </div>

        <div className="reveal mt-6" style={{ animationDelay: "60ms" }}>
          <SiteContextBar userId={user?.id ?? null} />
        </div>

        <StudioWorkspace
          wordPressConnected={wpConnection !== null}
          wordPressSiteUrl={wpConnection?.siteUrl ?? null}
          initialPlannerMessages={plannerMessages}
        />
      </main>
    </div>
  );
}
