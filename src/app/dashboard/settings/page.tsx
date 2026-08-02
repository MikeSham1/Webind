import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import WordPressConnectionForm from "@/components/WordPressConnectionForm";
import { getCurrentUser } from "@/lib/auth";
import { getWordPressConnectionStatus } from "@/lib/integrations/connections";

export const metadata: Metadata = {
  title: "Settings — WeBind",
  robots: { index: false, follow: false, nocache: true },
};

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const connection = await getWordPressConnectionStatus(user.id);

  return (
    <main className="mx-auto w-full max-w-2xl px-6 py-12">
      <Link
        href="/dashboard"
        className="font-mono text-xs uppercase tracking-[0.16em] text-muted hover:text-accent"
      >
        ← Dashboard
      </Link>

      <div className="mt-6">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted">
          Settings
        </p>
        <h1 className="mt-2 font-display text-3xl font-semibold text-ink">
          Connections
        </h1>
        <p className="mt-3 max-w-lg text-[15px] leading-relaxed text-muted">
          Connect your WordPress site so approved Content Studio drafts can be
          published there in one click, with a roll-back if you change your
          mind.
        </p>
      </div>

      <div className="mt-8">
        <WordPressConnectionForm connection={connection} />
      </div>
    </main>
  );
}
