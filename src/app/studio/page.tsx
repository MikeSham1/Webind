import type { Metadata } from "next";
import Link from "next/link";
import StudioForm from "@/components/StudioForm";

export const metadata: Metadata = {
  title: "Content Studio — WeBind",
  robots: { index: false, follow: false, nocache: true },
};

export default function StudioPage() {
  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-14">
      <div className="mb-10">
        <Link
          href="/"
          className="font-mono text-xs uppercase tracking-[0.16em] text-muted hover:text-accent"
        >
          ← Authority report
        </Link>
        <p className="mt-6 font-mono text-xs uppercase tracking-[0.2em] text-muted">
          Content Studio
        </p>
        <h1 className="mt-2 font-display text-4xl font-semibold text-ink">
          Build authority-boosting content
        </h1>
        <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-muted">
          Answer a few questions. We assemble a draft grounded{" "}
          <em>only</em> in the facts you provide, run safety checks, and hold it
          for your approval — nothing is finalized automatically.
        </p>
      </div>
      <StudioForm />
    </main>
  );
}
