"use server";

import { generateDraft } from "@/lib/content/generate";
import { runSafetyGates } from "@/lib/content/gates";
import {
  approvedMarkdown,
  getDraftById,
  getDraftForUser,
  revertDraftToPendingReview,
  saveDraft,
  saveDraftEdit,
  setAnyDraftStatus,
  setDraftStatus,
} from "@/lib/content/store";
import { getCurrentUser } from "@/lib/auth";
import { getWordPressCredentials } from "@/lib/integrations/connections";
import {
  beginPublish,
  destinationMatches,
  getPublicationForDraft,
  recordPublished,
  recordPublishFailed,
  recordRolledBack,
  recordWpDraftCreated,
} from "@/lib/integrations/publications";
import { markdownToHtml, stripLeadingTitle } from "@/lib/integrations/markdown";
import {
  buildPreviewUrl,
  createPage,
  getPageStatus,
  setPageStatus,
  wordPressPostTypeFor,
} from "@/lib/integrations/wordpress";
import { checkRateLimit, formatRetryAfter } from "@/lib/rateLimit";
import { getClientIp } from "@/lib/requestIp";
import { recordAudit } from "@/lib/audit";
import type { ContentInputs, DraftStatus, GateReport, PageType } from "@/lib/content/types";
import type { DecisionState, PublishState, StudioState } from "./state";

const PAGE_TYPES: PageType[] = ["landing", "blog", "product", "about", "faq"];

function splitLines(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseInputs(formData: FormData): ContentInputs | null {
  const topic = String(formData.get("topic") ?? "").trim();
  const audience = String(formData.get("audience") ?? "").trim();
  const keyFacts = splitLines(String(formData.get("keyFacts") ?? ""));
  if (!topic || keyFacts.length === 0) return null;

  const rawType = String(formData.get("pageType") ?? "landing");
  const pageType = PAGE_TYPES.includes(rawType as PageType)
    ? (rawType as PageType)
    : "landing";

  const keywords = String(formData.get("keywords") ?? "")
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean);

  return {
    topic,
    pageType,
    audience: audience || "your customers",
    tone: String(formData.get("tone") ?? "professional").trim() || "professional",
    keyFacts,
    keywords: keywords.length ? keywords : undefined,
    brandName: String(formData.get("brandName") ?? "").trim() || undefined,
    existingContent:
      String(formData.get("existingContent") ?? "").trim() || undefined,
    targetUrl: String(formData.get("targetUrl") ?? "").trim() || undefined,
  };
}

/** Generate a grounded, gated draft from the Q&A and save it for review. */
export async function createDraftAction(
  _prev: StudioState,
  formData: FormData,
): Promise<StudioState> {
  const user = await getCurrentUser();
  // Works anonymously (like the free report), so key by account when signed
  // in and fall back to IP otherwise.
  const limitKey = user ? `create-draft:user:${user.id}` : `create-draft:ip:${await getClientIp()}`;
  const limit = checkRateLimit(limitKey, 60 * 60 * 1000, 20);
  if (!limit.allowed) {
    return { status: "error", error: formatRetryAfter(limit.retryAfterMs) };
  }

  const inputs = parseInputs(formData);
  if (!inputs) {
    return {
      status: "error",
      error: "Add a topic and at least one key fact to generate a draft.",
    };
  }
  const draft = await generateDraft(inputs);
  const draftId = await saveDraft(inputs, draft, user?.id ?? null); // best-effort
  return { status: "created", draft, draftId };
}

/**
 * Render markdown to the exact HTML that would be sent to WordPress, so the
 * in-editor preview and the published page can never silently diverge —
 * there is no separate preview renderer to keep in sync with this one.
 * Stateless and side-effect-free; no auth/rate-limit needed; the caller
 * already has this text (it's in their own editor).
 */
export async function previewMarkdownAction(markdown: string, title: string): Promise<string> {
  return markdownToHtml(stripLeadingTitle(markdown, title));
}

/**
 * Autosave the reviewer's in-progress edit before they've approved/rejected —
 * called directly from the editor (not a form submission), the same pattern
 * previewMarkdownAction uses. Owner-only, and only while still pending review;
 * saveDraftEdit itself enforces both, so this just needs to be logged in.
 * Silent on failure by design (see saveDraftEdit) — the caller's own textarea
 * still holds the text either way.
 */
export async function saveDraftEditAction(draftId: string, markdown: string): Promise<void> {
  const user = await getCurrentUser();
  if (!user || !draftId) return;
  await saveDraftEdit(draftId, user.id, markdown);
}

/** Approve or reject a saved draft — the mandatory human step. */
export async function decideDraftAction(
  _prev: DecisionState,
  formData: FormData,
): Promise<DecisionState> {
  const draftId = String(formData.get("draftId") ?? "");
  const decision = String(formData.get("decision") ?? "");
  const status: DraftStatus = decision === "approve" ? "approved" : "rejected";

  if (!draftId) {
    return {
      status: "error",
      error: "This draft wasn't saved (database off), so there's nothing to update.",
    };
  }

  const user = await getCurrentUser();
  if (!user) {
    return { status: "error", error: "Log in to approve or reject this draft." };
  }

  // Admins can moderate any draft; everyone else only their own — load through
  // the same boundary the write below uses, not just for the write itself.
  const existing = user.isAdmin
    ? await getDraftById(draftId)
    : await getDraftForUser(draftId, user.id);
  if (!existing) {
    return { status: "error", error: "Couldn't find that draft." };
  }

  // The revision this decision actually covers: the submitted (possibly
  // edited) text, so what gets checked, stored, and later published is always
  // the same thing the reviewer looked at — never a stale value read back
  // from the row after the fact.
  let humanFinal: string | null | undefined;
  let gates: GateReport | undefined;
  if (status === "approved") {
    const submitted = String(formData.get("markdown") ?? "").trim();
    const revision = submitted || (existing.markdown ?? "").trim();
    if (!existing.inputs) {
      return {
        status: "error",
        error: "This draft is missing its source facts, so its safety checks can't be verified. Contact support.",
      };
    }
    // The UI disables Approve on a blocked draft, but that's advisory only —
    // a direct submission must be re-checked here against the revision being
    // approved, not the stale gates computed at generation time against the
    // model's original (pre-edit) text.
    gates = runSafetyGates(existing.inputs, revision);
    if (gates.blocked) {
      return {
        status: "error",
        error: "A safety check is blocking this revision — resolve it before approving.",
      };
    }
    humanFinal = revision;
  }

  const ok = user.isAdmin
    ? await setAnyDraftStatus(draftId, status, humanFinal, gates)
    : await setDraftStatus(draftId, user.id, status, humanFinal, gates);

  return ok
    ? { status: "done", decision: status }
    : {
        status: "error",
        error: "Couldn't save your decision — the draft may not be yours.",
      };
}

/**
 * "Revise and resubmit": send an approved or rejected draft back to
 * pending_review so it can be edited and re-decided, instead of the decision
 * UI silently re-appearing as if nothing had ever been decided. A draft that
 * was approved AND already published refuses here — rolling back the live
 * publication first is the explicit, visible step that should precede
 * touching the content behind it, not an implicit side effect of revising.
 */
export async function reviseDraftAction(
  formData: FormData,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const draftId = String(formData.get("draftId") ?? "");
  if (!draftId) return { ok: false, error: "Missing draft." };

  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Log in to revise this draft." };

  const existing = await getDraftForUser(draftId, user.id);
  if (!existing) return { ok: false, error: "Couldn't find that draft." };

  if (existing.status === "approved") {
    const publication = await getPublicationForDraft(draftId);
    if (publication && (publication.status === "wp_draft" || publication.status === "published")) {
      return {
        ok: false,
        error: "This draft is already published — roll it back before revising it.",
      };
    }
  }

  const ok = await revertDraftToPendingReview(draftId, user.id);
  return ok ? { ok: true } : { ok: false, error: "Couldn't revise this draft." };
}

/**
 * Shared validation for the publish/confirm/rollback actions below.
 *
 * Owner-only — deliberately does NOT use the admin bypass that draft-viewing
 * pages use (getDraftById). An admin can review and moderate (approve/
 * reject) any draft via decideDraftAction above, but writing to a customer's
 * own WordPress site is an action only the draft's owner can take, even
 * though the destination is always correctly routed to the owner's site
 * either way. No delegated-publishing path exists yet; an admin who needs to
 * act on a user's behalf has to do it as that user.
 */
async function loadOwnedDraft(draftId: string, userId: string) {
  return getDraftForUser(draftId, userId);
}

/**
 * Stage 1 of publishing: create the page on WordPress as a DRAFT — never
 * live. Content only reaches a customer's site after a human approved it
 * here (the mandatory gate this feature is built around) AND, separately,
 * only goes LIVE after a second explicit confirmation (confirmGoLiveAction)
 * once they've reviewed the WordPress draft itself — two independent human
 * checkpoints, not one.
 *
 * Records a `pending` row before ever calling WordPress (see beginPublish),
 * so a retry after a crash/DB hiccup can't create a duplicate page, and every
 * attempt — success or failure — is written to the audit trail.
 */
export async function publishDraftAction(
  _prev: PublishState,
  formData: FormData,
): Promise<PublishState> {
  const draftId = String(formData.get("draftId") ?? "");
  if (!draftId) {
    return { status: "error", error: "This draft wasn't saved, so there's nothing to publish." };
  }

  const user = await getCurrentUser();
  if (!user) return { status: "error", error: "Log in to publish this draft." };

  const limit = checkRateLimit(`publish:${user.id}`, 60 * 60 * 1000, 15);
  if (!limit.allowed) {
    return { status: "error", error: formatRetryAfter(limit.retryAfterMs) };
  }

  const draft = await loadOwnedDraft(draftId, user.id);
  if (!draft) return { status: "error", error: "Couldn't find that draft." };
  if (draft.status !== "approved") {
    return { status: "error", error: "Approve this draft before publishing it." };
  }
  if (!draft.userId) {
    return { status: "error", error: "This draft has no owner to publish on behalf of." };
  }

  const creds = await getWordPressCredentials(draft.userId);
  if (!creds) {
    return { status: "error", error: "Connect WordPress in Settings before publishing." };
  }

  const begin = await beginPublish(draftId, draft.userId);
  if (!begin.ok) {
    if (begin.reason === "in_progress") {
      return {
        status: "error",
        error: "A publish is already in progress for this draft — try again shortly.",
      };
    }
    if (begin.reason === "claim_failed") {
      // Fail closed: never proceed to a live WordPress call without a
      // durably recorded intent to write. Safe to ask the user to retry —
      // no write has happened yet.
      return {
        status: "error",
        error: "Couldn't start the publish — please try again.",
      };
    }
    // already_active: something real already exists on WordPress; report it
    // rather than creating a second page — but only if it's still on the
    // site we're currently connected to (see destinationMatches).
    const row = begin.row;
    if (!destinationMatches(row, creds.siteUrl)) {
      return {
        status: "error",
        error: `This draft was already published to a different WordPress site (${row.wpSiteUrl}) than the one currently connected (${creds.siteUrl}). Reconnect that site to manage it, or start a fresh draft.`,
      };
    }

    // Reconciliation: the cached row only reflects what WeBind last did, not
    // what's actually on WordPress right now — a page can be deleted or
    // trashed directly there at any time. Without this check, a draft whose
    // WordPress page was removed externally would be stuck forever: this
    // branch would keep handing back a dead link, and beginPublish would
    // keep refusing a fresh attempt because the row still claims something's
    // already live. Verify before trusting it, and if it's genuinely gone,
    // clear the stale record and fall through to publish fresh below.
    let stale = false;
    if (row.wpPostId) {
      const remote = await getPageStatus(creds, row.wpPostId, {
        postType: row.wpPostType ?? "page",
      });
      if (!remote.ok && remote.notFound) {
        stale = true;
        await recordPublishFailed(
          draftId,
          "The WordPress page no longer exists — it may have been deleted directly on WordPress.",
        );
        await recordAudit({
          actorUserId: user.id,
          action: "wordpress.reconcile",
          destination: creds.siteUrl,
          beforeState: { status: row.status, postId: row.wpPostId },
          afterState: { status: "failed" },
          result: "success",
        });
      }
      // Any other outcome (still there, or a transient check failure) falls
      // through to the trusted-cache behavior below, unchanged from before.
    }

    if (!stale) {
      if (row.status === "published" && row.wpViewUrl && row.wpEditUrl) {
        return { status: "published", viewUrl: row.wpViewUrl, editUrl: row.wpEditUrl };
      }
      if (row.status === "wp_draft" && row.wpEditUrl && row.wpPostId) {
        return {
          status: "wp_draft",
          previewUrl: buildPreviewUrl(creds.siteUrl, row.wpPostId),
          editUrl: row.wpEditUrl,
        };
      }
      // Any other combination is unexpected; fall through and attempt fresh.
    } else {
      // Reclaim the slot now that the stale record is cleared, then fall
      // through to create a fresh page below — same as a first-time publish.
      const reclaim = await beginPublish(draftId, draft.userId);
      if (!reclaim.ok) {
        return {
          status: "error",
          error: "That WordPress page no longer exists, and re-claiming the publish slot failed — try again.",
        };
      }
    }
  }

  const title = draft.title || draft.topic;
  const contentHtml = markdownToHtml(stripLeadingTitle(approvedMarkdown(draft), title));
  const postType = wordPressPostTypeFor(draft.inputs?.pageType ?? "landing");

  const page = await createPage(creds, { title, contentHtml, status: "draft", postType });
  if (!page.ok) {
    await recordPublishFailed(draftId, page.error);
    await recordAudit({
      actorUserId: user.id,
      action: "wordpress.create_draft",
      destination: creds.siteUrl,
      afterState: { title },
      result: "failure",
      error: page.error,
    });
    return { status: "error", error: page.error };
  }

  const recorded = await recordWpDraftCreated(draftId, page, {
    siteUrl: creds.siteUrl,
    connectionId: creds.connectionId,
    postType,
  });
  await recordAudit({
    actorUserId: user.id,
    action: "wordpress.create_draft",
    destination: creds.siteUrl,
    afterState: { postId: page.postId, editUrl: page.editUrl },
    result: recorded ? "success" : "failure",
    error: recorded ? undefined : "Created on WordPress but failed to save the local record.",
  });
  if (!recorded) {
    // Surface the WordPress link directly so nothing is silently lost even
    // though our own bookkeeping failed.
    return {
      status: "error",
      error: `Created on WordPress but couldn't save the record. Draft: ${page.editUrl}`,
    };
  }

  return { status: "wp_draft", previewUrl: page.previewUrl, editUrl: page.editUrl };
}

/**
 * Stage 2 of publishing: bring an already-created WordPress draft live.
 * Deliberately a separate action from publishDraftAction, invoked only after
 * the UI has shown a preview and the user clicked a distinctly-labeled
 * confirmation — see PublishBar.tsx.
 */
export async function confirmGoLiveAction(
  _prev: PublishState,
  formData: FormData,
): Promise<PublishState> {
  const draftId = String(formData.get("draftId") ?? "");
  const user = await getCurrentUser();
  if (!user) return { status: "error", error: "Log in to publish this draft." };

  const limit = checkRateLimit(`publish:${user.id}`, 60 * 60 * 1000, 15);
  if (!limit.allowed) {
    return { status: "error", error: formatRetryAfter(limit.retryAfterMs) };
  }

  const draft = await loadOwnedDraft(draftId, user.id);
  if (!draft || !draft.userId) return { status: "error", error: "Couldn't find that draft." };
  // Approval can be revoked or superseded between creating the WordPress draft
  // and confirming it live (rejected by an admin, or re-decided some other
  // way) — re-check it here rather than trusting that publishDraftAction's
  // earlier check still holds.
  if (draft.status !== "approved") {
    return {
      status: "error",
      error: "This draft is no longer approved — approve it again before going live.",
    };
  }

  const publication = await getPublicationForDraft(draftId);
  if (!publication || publication.status !== "wp_draft" || !publication.wpPostId) {
    return { status: "error", error: "Create the WordPress draft first." };
  }

  const creds = await getWordPressCredentials(draft.userId);
  if (!creds) return { status: "error", error: "WordPress isn't connected anymore." };
  if (!destinationMatches(publication, creds.siteUrl)) {
    return {
      status: "error",
      error: `This draft's WordPress post lives on ${publication.wpSiteUrl}, not the currently connected ${creds.siteUrl}. Reconnect the original site before going live.`,
    };
  }

  // Reconciliation: the WordPress draft this row points to can be deleted or
  // trashed directly on WordPress between its creation and this confirmation
  // — verify it's still there before trying to flip it live. Without this,
  // setPageStatus would just fail with a generic WordPress error, and the row
  // would stay stuck in `wp_draft` forever with no path back to publishing
  // (publishDraftAction's already_active check would keep refusing a retry).
  const remote = await getPageStatus(creds, publication.wpPostId, {
    postType: publication.wpPostType ?? "page",
  });
  if (!remote.ok && remote.notFound) {
    await recordPublishFailed(
      draftId,
      "The WordPress draft no longer exists — it may have been deleted directly on WordPress.",
    );
    await recordAudit({
      actorUserId: user.id,
      action: "wordpress.reconcile",
      destination: creds.siteUrl,
      beforeState: { status: publication.status, postId: publication.wpPostId },
      afterState: { status: "failed" },
      result: "success",
    });
    return {
      status: "error",
      error: "That WordPress draft no longer exists — publish this draft again to recreate it.",
    };
  }

  const result = await setPageStatus(creds, publication.wpPostId, "publish", undefined, {
    postType: publication.wpPostType ?? "page",
  });
  if (!result.ok) {
    await recordAudit({
      actorUserId: user.id,
      action: "wordpress.publish",
      destination: creds.siteUrl,
      beforeState: { status: "wp_draft", postId: publication.wpPostId },
      result: "failure",
      error: result.error,
    });
    return { status: "error", error: result.error };
  }

  const recorded = await recordPublished(draftId, draft.userId, result);
  await recordAudit({
    actorUserId: user.id,
    action: "wordpress.publish",
    destination: creds.siteUrl,
    beforeState: { status: "wp_draft", postId: publication.wpPostId },
    afterState: { status: "published", viewUrl: result.viewUrl },
    result: recorded ? "success" : "failure",
    error: recorded ? undefined : "Published on WordPress but failed to save the local record.",
  });
  if (!recorded) {
    return {
      status: "error",
      error: `Live on WordPress but couldn't save the record. Live at: ${result.viewUrl}`,
    };
  }

  return { status: "published", viewUrl: result.viewUrl, editUrl: result.editUrl };
}

/**
 * Undo a publish by flipping the WordPress page back to draft status — never
 * deletes anything on the customer's site.
 */
export async function rollbackPublicationAction(
  _prev: PublishState,
  formData: FormData,
): Promise<PublishState> {
  const draftId = String(formData.get("draftId") ?? "");
  const user = await getCurrentUser();
  if (!user) return { status: "error", error: "Log in to roll this back." };

  const limit = checkRateLimit(`rollback:${user.id}`, 60 * 60 * 1000, 15);
  if (!limit.allowed) {
    return { status: "error", error: formatRetryAfter(limit.retryAfterMs) };
  }

  const draft = await loadOwnedDraft(draftId, user.id);
  if (!draft) return { status: "error", error: "Couldn't find that draft." };
  if (!draft.userId) {
    return { status: "error", error: "This draft has no owner to publish on behalf of." };
  }

  const publication = await getPublicationForDraft(draftId);
  if (!publication || publication.status !== "published" || !publication.wpPostId) {
    return { status: "error", error: "This draft isn't currently live." };
  }

  const creds = await getWordPressCredentials(draft.userId);
  if (!creds) return { status: "error", error: "WordPress isn't connected anymore." };
  if (!destinationMatches(publication, creds.siteUrl)) {
    return {
      status: "error",
      error: `This draft's WordPress post lives on ${publication.wpSiteUrl}, not the currently connected ${creds.siteUrl}. Reconnect the original site before rolling it back.`,
    };
  }

  const result = await setPageStatus(creds, publication.wpPostId, "draft", undefined, {
    postType: publication.wpPostType ?? "page",
  });
  if (!result.ok) {
    await recordAudit({
      actorUserId: user.id,
      action: "wordpress.rollback",
      destination: creds.siteUrl,
      beforeState: { status: "published", postId: publication.wpPostId },
      result: "failure",
      error: result.error,
    });
    return { status: "error", error: result.error };
  }

  await recordAudit({
    actorUserId: user.id,
    action: "wordpress.rollback",
    destination: creds.siteUrl,
    beforeState: { status: "published", postId: publication.wpPostId },
    afterState: { status: "rolled_back" },
    result: "success",
  });
  await recordRolledBack(draftId);
  return { status: "rolled_back" };
}
