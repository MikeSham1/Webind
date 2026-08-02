"use server";

import { revalidatePath } from "next/cache";
import { normalizeUrl } from "@/lib/crawler/ssrf";
import { getCurrentUser } from "@/lib/auth";
import { deleteWordPressConnection, saveWordPressConnection } from "@/lib/integrations/connections";
import { testConnection } from "@/lib/integrations/wordpress";
import type { ConnectionState } from "./state";

/** Connect (or replace) the user's WordPress site. Verifies the credentials before saving. */
export async function connectWordPressAction(
  _prev: ConnectionState,
  formData: FormData,
): Promise<ConnectionState> {
  const user = await getCurrentUser();
  if (!user) return { status: "error", error: "Log in to connect a WordPress site." };

  const siteUrl = normalizeUrl(String(formData.get("siteUrl") ?? ""));
  const username = String(formData.get("username") ?? "").trim();
  const appPassword = String(formData.get("appPassword") ?? "").trim();

  if (!siteUrl) {
    return {
      status: "error",
      error: "Enter your site's web address, e.g. https://yoursite.com.",
    };
  }
  if (!username || !appPassword) {
    return {
      status: "error",
      error: "Enter your WordPress username and Application Password.",
    };
  }

  const verified = await testConnection({ siteUrl, username, appPassword });
  if (!verified.ok) return { status: "error", error: verified.error };

  const saved = await saveWordPressConnection(user.id, { siteUrl, username, appPassword });
  if (!saved) {
    return {
      status: "error",
      error: "Couldn't save that connection — is a database configured?",
    };
  }

  revalidatePath("/dashboard/settings");
  return { status: "connected", siteUrl, username };
}

export async function disconnectWordPressAction(): Promise<void> {
  const user = await getCurrentUser();
  if (user) await deleteWordPressConnection(user.id);
  revalidatePath("/dashboard/settings");
}
