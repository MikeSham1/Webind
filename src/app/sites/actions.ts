"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth";
import { addSite, removeSite, setPrimarySite } from "@/lib/sites/store";
import type { SiteActionState } from "./state";

/**
 * The active site scopes every page that renders it — the studio, and the
 * dashboard's key insights and embedded studio. Revalidating only one of them
 * would leave the other showing the site the user just switched away from.
 */
function revalidateSiteContext(): void {
  revalidatePath("/studio");
  revalidatePath("/dashboard");
}

/**
 * Switch which of the user's websites is the active context — the one the AI
 * assumes when they say "my site". Ownership is enforced in setPrimarySite, so
 * a forged siteId can't re-point someone else's context.
 */
export async function selectSiteAction(
  _prev: SiteActionState,
  formData: FormData,
): Promise<SiteActionState> {
  const user = await getCurrentUser();
  if (!user) return { status: "error", error: "Log in to switch sites." };
  const siteId = String(formData.get("siteId") ?? "");
  if (!siteId) return { status: "error", error: "Choose a site to switch to." };

  const ok = await setPrimarySite(user.id, siteId);
  if (!ok) {
    return { status: "error", error: "Couldn't switch sites — try again." };
  }
  revalidateSiteContext();
  return { status: "idle" };
}

/** Add a website by hand, for a site that hasn't been reported on yet. */
export async function addSiteAction(
  _prev: SiteActionState,
  formData: FormData,
): Promise<SiteActionState> {
  const user = await getCurrentUser();
  if (!user) return { status: "error", error: "Log in to add a site." };
  const url = String(formData.get("url") ?? "").trim();
  if (!url) return { status: "error", error: "Enter a website address." };

  const result = await addSite(user.id, url);
  if (!result.ok) {
    return {
      status: "error",
      error:
        result.reason === "limit"
          ? `Your plan manages up to ${result.limit} site${result.limit === 1 ? "" : "s"}. Remove one in Settings first, or upgrade for more.`
          : "That doesn't look like a website address — try just the domain, like yourdomain.com.",
    };
  }
  revalidateSiteContext();
  return { status: "idle" };
}

/**
 * Remove a managed site — the counterpart addSite's limit error points to.
 * Never deletes the reports/drafts already run against it, only stops
 * tracking it as one of the user's active sites (freeing a slot on plans
 * with a cap). Ownership is enforced in removeSite.
 */
export async function removeSiteAction(formData: FormData): Promise<void> {
  const user = await getCurrentUser();
  if (!user) return;
  const siteId = String(formData.get("siteId") ?? "");
  if (!siteId) return;
  await removeSite(user.id, siteId);
  revalidateSiteContext();
  revalidatePath("/dashboard/settings");
}
