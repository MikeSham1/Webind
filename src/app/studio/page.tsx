import type { Metadata } from "next";
import StudioForm from "@/components/StudioForm";
import ContentPlanner from "@/components/ContentPlanner";
import SiteHeader from "@/components/SiteHeader";
import { getCurrentUser } from "@/lib/auth";
import { getWordPressConnectionStatus } from "@/lib/integrations/connections";

export const metadata: Metadata = {
  title: "Content Studio — WeBind Design",
  robots: { index: false, follow: false, nocache: true },
};

export const dynamic = "force-dynamic";

export default async function StudioPage() {
  const user = await getCurrentUser();
  const wordPressConnected = user
    ? (await getWordPressConnectionStatus(user.id)) !== null
    : false;

  return (
    <div className="flex min-h-full flex-col">
      <SiteHeader />
      <main className="mx-auto w-full max-w-3xl flex-1 px-6 pb-14">
        <div className="mb-10">
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted">
            Content Studio
          </p>
          <h1 className="mt-2 font-display text-4xl font-semibold text-ink">
            Build authority-boosting content
          </h1>
          <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-muted">
            Talk through the page with Gemini first, then turn the clarified brief into a draft grounded{" "}
            <em>only</em> in the facts you provide. Every draft is safety-checked and held for your approval.
          </p>
        </div>
        <ContentPlanner />
        <StudioForm wordPressConnected={wordPressConnected} />
      </main>
    </div>
  );
}
