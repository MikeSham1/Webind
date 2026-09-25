"use client";

import { useActionState } from "react";
import { createDraftAction } from "@/app/studio/actions";
import { initialStudioState } from "@/app/studio/state";
import DraftView from "./DraftView";
import type { DraftBrief } from "@/app/studio/brief";

const inputClass =
  "mt-1.5 w-full rounded-lg border border-line-strong bg-paper px-3 py-2.5 font-sans text-[15px] text-ink placeholder:text-muted/60 focus-visible:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft";

export default function StudioForm({
  wordPressConnected,
  brief = null,
  wordPressSiteUrl = null,
}: {
  wordPressConnected: boolean;
  /** Starting values carried over from the planning conversation, if any. */
  brief?: DraftBrief | null;
  /** The connected WordPress site drafts will actually publish to. */
  wordPressSiteUrl?: string | null;
}) {
  const [state, formAction, isPending] = useActionState(
    createDraftAction,
    initialStudioState,
  );

  return (
    <div className="space-y-10">
      <form
        action={formAction}
        className="space-y-5 rounded-2xl border border-line bg-surface p-6 sm:p-8"
      >
        {brief && (
          // The model filled these in, so say so plainly. Key facts are the
          // only thing the draft is allowed to assert — they get read, not
          // trusted.
          <div className="rounded-xl border border-accent/30 bg-accent-soft/40 px-4 py-3">
            <p className="text-sm text-ink">
              <strong className="font-semibold">Filled in from your conversation.</strong>{" "}
              <span className="text-muted">
                Check the key facts before drafting — the draft may assert
                nothing else.
              </span>
            </p>
          </div>
        )}

        <Field label="Topic / working title" hint="What is this page about?">
          <input
            name="topic"
            required
            defaultValue={brief?.topic ?? ""}
            placeholder="Managed IT support for law firms"
            className={inputClass}
          />
        </Field>

        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Page type">
            <select
              name="pageType"
              defaultValue={brief?.pageType ?? "landing"}
              className={inputClass}
            >
              <option value="landing">Landing page</option>
              <option value="blog">Blog post</option>
              <option value="product">Product page</option>
              <option value="about">About page</option>
              <option value="faq">FAQ</option>
            </select>
          </Field>
          <Field label="Tone">
            <input
              name="tone"
              defaultValue={brief?.tone ?? "professional"}
              placeholder="professional, friendly…"
              className={inputClass}
            />
          </Field>
        </div>

        <Field label="Audience" hint="Who is it for?">
          <input
            name="audience"
            defaultValue={brief?.audience ?? ""}
            placeholder="small law firms in Denver"
            className={inputClass}
          />
        </Field>

        <Field
          label="Key facts"
          hint="One per line. The draft may ONLY assert these — this is what keeps it truthful."
        >
          <textarea
            name="keyFacts"
            required
            rows={5}
            defaultValue={brief?.keyFacts ?? ""}
            placeholder={"24/7 helpdesk\nResponse within 15 minutes\nSOC 2 certified\nBased in Denver, CO"}
            className={inputClass}
          />
        </Field>

        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Brand name" hint="Optional">
            <input
              name="brandName"
              defaultValue={brief?.brandName ?? ""}
              placeholder="Acme IT"
              className={inputClass}
            />
          </Field>
          <Field label="Target keywords" hint="Optional, comma-separated">
            <input
              name="keywords"
              defaultValue={brief?.keywords ?? ""}
              placeholder="managed IT, helpdesk"
              className={inputClass}
            />
          </Field>
        </div>

        <Field
          label="Existing page content"
          hint="Optional — paste it to enable the originality (duplicate-content) check."
        >
          <textarea
            name="existingContent"
            rows={3}
            className={inputClass}
            placeholder="Paste the current page copy here…"
          />
        </Field>

        <div className="flex items-center gap-4 pt-1">
          <button
            type="submit"
            disabled={isPending}
            className="inline-flex h-11 items-center justify-center rounded-full bg-accent px-6 font-sans text-[15px] font-semibold text-accent-ink transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-70"
          >
            {isPending ? "Generating…" : "Generate draft"}
          </button>
          <span className="text-xs text-muted">
            Grounded · Safety-checked · Needs your approval
          </span>
        </div>

        {state.status === "error" && (
          <p role="alert" className="text-sm text-bad">
            {state.error}
          </p>
        )}

        {/* Where this actually ends up. Generating a draft you then can't
            publish is a dead end, so say which it is before they spend the call. */}
        <p className="border-t border-line pt-4 text-xs text-muted">
          {wordPressConnected ? (
            <>
              Approved drafts publish to{" "}
              <strong className="font-semibold text-ink">
                {wordPressSiteUrl ?? "your connected WordPress site"}
              </strong>{" "}
              — as a WordPress draft first, then only go live when you confirm.
            </>
          ) : (
            <>
              No site connected yet, so drafts stay here.{" "}
              <a href="/dashboard/settings" className="text-accent hover:underline">
                Connect WordPress
              </a>{" "}
              to publish them to your real site in one click.
            </>
          )}
        </p>
      </form>

      {state.status === "created" && (
        <DraftView
          draft={state.draft}
          draftId={state.draftId}
          wordPressConnected={wordPressConnected}
          wordPressSiteUrl={wordPressSiteUrl}
        />
      )}
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="font-sans text-sm font-medium text-ink">{label}</span>
      {hint && <span className="ml-2 text-xs text-muted">{hint}</span>}
      {children}
    </label>
  );
}
