"use server";

import { generateDraft } from "@/lib/content/generate";
import { saveDraft, setDraftStatus } from "@/lib/content/store";
import type { ContentInputs, DraftStatus, PageType } from "@/lib/content/types";
import type { DecisionState, StudioState } from "./state";

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
  const inputs = parseInputs(formData);
  if (!inputs) {
    return {
      status: "error",
      error: "Add a topic and at least one key fact to generate a draft.",
    };
  }
  const draft = generateDraft(inputs);
  const draftId = await saveDraft(inputs, draft); // best-effort
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
  const ok = await setDraftStatus(draftId, status);
  return ok
    ? { status: "done", decision: status }
    : { status: "error", error: "Couldn't save your decision — try again." };
}
