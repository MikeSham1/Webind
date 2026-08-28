"use server";

import { generateDraft } from "@/lib/content/generate";
import {
  getDraftById,
  getDraftForUser,
  saveDraft,
  setAnyDraftStatus,
  setDraftStatus,
} from "@/lib/content/store";
import { getCurrentUser } from "@/lib/auth";
import { getWordPressCredentials } from "@/lib/integrations/connections";
import {
  beginPublish,
  getPublicationForDraft,
  recordPublished,
  recordPublishFailed,
  recordRolledBack,
  recordWpDraftCreated,
} from "@/lib/integrations/publications";
import { markdownToHtml, stripLeadingTitle } from "@/lib/integrations/markdown";
import { buildPreviewUrl, createPage, setPageStatus } from "@/lib/integrations/wordpress";
import { checkRateLimit, formatRetryAfter } from "@/lib/rateLimit";
import { getClientIp } from "@/lib/requestIp";
import { recordAudit } from "@/lib/audit";
import type { ContentInputs, DraftStatus, PageType } from "@/lib/content/types";
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

  // Capture the human's edits on approval — the highest-value training target.
  // Only stored when the text actually changed from the model's draft.
  let humanFinal: string | null | undefined;
  if (status === "approved") {
    const edited = String(formData.get("markdown") ?? "").trim();
    const existing = await getDraftById(draftId);
    if (existing && edited && edited !== (existing.markdown ?? "").trim()) {
      humanFinal = edited;
    }
  }

  // Admins can moderate any draft; everyone else only their own.
  const ok = user.isAdmin
    ? await setAnyDraftStatus(draftId, status, humanFinal)
    : await setDraftStatus(draftId, user.id, status, humanFinal);

  return ok
    ? { status: "done", decision: status }
    : {
        status: "error",
        error: "Couldn't save your decision — the draft may not be yours.",
      };
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
    // already_active: something real already exists on WordPress; report it
    // rather than creating a second page.
    const row = begin.row;
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
  }

  const title = draft.title || draft.topic;
  const contentHtml = markdownToHtml(stripLeadingTitle(draft.markdown ?? "", title));

  const page = await createPage(creds, { title, contentHtml, status: "draft" });
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

  const recorded = await recordWpDraftCreated(draftId, page);
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

  const publication = await getPublicationForDraft(draftId);
  if (!publication || publication.status !== "wp_draft" || !publication.wpPostId) {
    return { status: "error", error: "Create the WordPress draft first." };
  }

  const creds = await getWordPressCredentials(draft.userId);
  if (!creds) return { status: "error", error: "WordPress isn't connected anymore." };

  const result = await setPageStatus(creds, publication.wpPostId, "publish");
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

  const result = await setPageStatus(creds, publication.wpPostId, "draft");
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
