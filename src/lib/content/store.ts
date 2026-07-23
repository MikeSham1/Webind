import { desc, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { contentDrafts, type ContentDraftRow } from "@/lib/db/schema";
import type { ContentDraft, ContentInputs, DraftStatus } from "./types";

/** Persist a generated draft (pending review). Null when persistence is off. */
export async function saveDraft(
  inputs: ContentInputs,
  draft: ContentDraft,
): Promise<string | null> {
  const db = getDb();
  if (!db) return null;
  try {
    const [row] = await db
      .insert(contentDrafts)
      .values({
        topic: inputs.topic,
        targetUrl: inputs.targetUrl ?? null,
        inputs,
        title: draft.title,
        markdown: draft.markdown,
        gates: draft.gates,
        status: "pending_review",
      })
      .returning({ id: contentDrafts.id });
    return row?.id ?? null;
  } catch (err) {
    console.error("saveDraft failed:", err);
    return null;
  }
}

/** Approve or reject a draft. Never throws. */
export async function setDraftStatus(
  id: string,
  status: DraftStatus,
): Promise<boolean> {
  const db = getDb();
  if (!db) return false;
  try {
    await db
      .update(contentDrafts)
      .set({ status, updatedAt: new Date() })
      .where(eq(contentDrafts.id, id));
    return true;
  } catch (err) {
    console.error("setDraftStatus failed:", err);
    return false;
  }
}

/** Recent drafts for the dashboard. Empty when persistence is off. */
export async function listDrafts(): Promise<ContentDraftRow[]> {
  const db = getDb();
  if (!db) return [];
  try {
    return await db
      .select()
      .from(contentDrafts)
      .orderBy(desc(contentDrafts.createdAt))
      .limit(50);
  } catch (err) {
    console.error("listDrafts failed:", err);
    return [];
  }
}
