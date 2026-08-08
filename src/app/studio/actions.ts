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
  getPublicationForDraft,
  recordPublished,
  recordRolledBack,
} from "@/lib/integrations/publications";
import { markdownToHtml, stripLeadingTitle } from "@/lib/integrations/markdown";
import { createPage, setPageStatus } from "@/lib/integrations/wordpress";
import { checkRateLimit, formatRetryAfter } from "@/lib/rateLimit";
import { getClientIp } from "@/lib/requestIp";
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
  const draft = generateDraft(inputs);
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

  // Admins can moderate any draft; everyone else only their own.
  const ok = user.isAdmin
    ? await setAnyDraftStatus(draftId, status)
    : await setDraftStatus(draftId, user.id, status);

  return ok
    ? { status: "done", decision: status }
    : {
        status: "error",
        error: "Couldn't save your decision — the draft may not be yours.",
      };
}

/**
 * Push an approved draft to its owner's connected WordPress site.
 *
 * Always the draft's own owner, not whoever clicks the button — an admin
 * reviewing someone else's draft must never publish it to the admin's own
 * unrelated site. A page already published for this draft is brought back
 * live in place (same WP post) rather than duplicated; one already live is
 * reported as-is. Content only ever reaches a customer's site once a human
 * approved it here — the mandatory gate this whole feature is built around.
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

  const draft = user.isAdmin
    ? await getDraftById(draftId)
    : await getDraftForUser(draftId, user.id);
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

  const title = draft.title || draft.topic;
  const contentHtml = markdownToHtml(stripLeadingTitle(draft.markdown ?? "", title));

  const existing = await getPublicationForDraft(draftId);
  if (existing?.status === "published") {
    return { status: "published", viewUrl: existing.wpViewUrl, editUrl: existing.wpEditUrl };
  }

  const page = existing
    ? await setPageStatus(creds, existing.wpPostId, "publish", contentHtml)
    : await createPage(creds, { title, contentHtml });
  if (!page.ok) return { status: "error", error: page.error };

  const recorded = await recordPublished(draftId, draft.userId, page);
  if (!recorded) {
    return {
      status: "error",
      error: "Published, but couldn't save the record — refresh to check its status.",
    };
  }

  return { status: "published", viewUrl: page.viewUrl, editUrl: page.editUrl };
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

  const draft = user.isAdmin
    ? await getDraftById(draftId)
    : await getDraftForUser(draftId, user.id);
  if (!draft) return { status: "error", error: "Couldn't find that draft." };
  if (!draft.userId) {
    return { status: "error", error: "This draft has no owner to publish on behalf of." };
  }

  const publication = await getPublicationForDraft(draftId);
  if (!publication || publication.status !== "published") {
    return { status: "error", error: "This draft isn't currently live." };
  }

  const creds = await getWordPressCredentials(draft.userId);
  if (!creds) return { status: "error", error: "WordPress isn't connected anymore." };

  const result = await setPageStatus(creds, publication.wpPostId, "draft");
  if (!result.ok) return { status: "error", error: result.error };

  await recordRolledBack(draftId);
  return { status: "rolled_back" };
}
