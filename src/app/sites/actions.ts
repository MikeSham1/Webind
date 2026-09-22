"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth";
import { addSite, setPrimarySite } from "@/lib/sites/store";

/**
 * Switch which of the user's websites is the active context — the one the AI
 * assumes when they say "my site". Ownership is enforced in setPrimarySite, so
 * a forged siteId can't re-point someone else's context.
 */
export async function selectSiteAction(formData: FormData): Promise<void> {
  const user = await getCurrentUser();
  if (!user) return;
  const siteId = String(formData.get("siteId") ?? "");
  if (!siteId) return;
  await setPrimarySite(user.id, siteId);
  revalidatePath("/studio");
}

/** Add a website by hand, for a site that hasn't been reported on yet. */
export async function addSiteAction(formData: FormData): Promise<void> {
  const user = await getCurrentUser();
  if (!user) return;
  const url = String(formData.get("url") ?? "");
  if (!url.trim()) return;
  await addSite(user.id, url);
  revalidatePath("/studio");
}
