"use client";

import { useState, useTransition } from "react";
import ContentPlanner from "./ContentPlanner";
import StudioForm from "./StudioForm";
import { buildBriefAction } from "@/app/studio/brief-actions";
import type { DraftBrief } from "@/app/studio/brief";
import type { PlannerMessage } from "@/app/studio/planner-state";

/**
 * Content Studio as one flow instead of two unrelated boxes.
 *
 * Plan -> Draft -> Publish. The planner and the draft form used to sit on the
 * same page knowing nothing about each other, so the conversation's whole
 * output was something you retyped by hand. This holds the brief between them:
 * the planner produces one, the form opens pre-filled with it, and the user
 * can edit every field before a word is generated.
 */
export default function StudioWorkspace({
  wordPressConnected,
  wordPressSiteUrl,
  initialPlannerMessages = [],
}: {
  wordPressConnected: boolean;
  /** The connected WordPress site drafts will actually publish to — not the analyzed site. */
  wordPressSiteUrl: string | null;
  /** The signed-in user's saved planner conversation, if any — resumed rather than lost on reload. */
  initialPlannerMessages?: PlannerMessage[];
}) {
  const [brief, setBrief] = useState<DraftBrief | null>(null);
  // Bumped with each new brief so the form remounts and picks up the new
  // defaultValues — without discarding anything the user typed themselves in
  // between, which a controlled form would do on every keystroke.
  const [briefVersion, setBriefVersion] = useState(0);
  const [briefError, setBriefError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  // Bumped on "start over" to remount ContentPlanner with a clean slate —
  // useActionState has no external reset, so a fresh mount is how we clear it.
  const [plannerKey, setPlannerKey] = useState(0);

  function useConversation(messages: PlannerMessage[]) {
    setBriefError(null);
    startTransition(async () => {
      const result = await buildBriefAction(messages);
      if (result.status === "error") {
        setBriefError(result.error);
        return;
      }
      setBrief(result.brief);
      setBriefVersion((v) => v + 1);
      // Send them to the form they just filled, rather than leaving the change
      // to happen silently below the fold.
      document.getElementById("draft-step")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  return (
    <>
      <div className="reveal mt-10" style={{ animationDelay: "120ms" }}>
        <StepLabel n={1} title="Plan" />
        <ContentPlanner
          key={plannerKey}
          initialMessages={plannerKey === 0 ? initialPlannerMessages : []}
          onUseBrief={useConversation}
          briefPending={isPending}
          briefError={briefError}
          onStartOver={() => setPlannerKey((k) => k + 1)}
        />
      </div>

      <div id="draft-step" className="reveal mt-12 scroll-mt-6" style={{ animationDelay: "180ms" }}>
        <StepLabel n={2} title="Draft" />
        <StudioForm
          key={briefVersion}
          brief={brief}
          wordPressConnected={wordPressConnected}
          wordPressSiteUrl={wordPressSiteUrl}
        />
      </div>
    </>
  );
}

/** A numbered step marker, so the halves read as one flow. */
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
