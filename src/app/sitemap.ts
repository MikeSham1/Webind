import type { MetadataRoute } from "next";
import { getBaseUrl } from "@/lib/baseUrl";

// getBaseUrl() reads request headers, which needs a real request context.
export const dynamic = "force-dynamic";

/** Public, indexable pages only — everything auth-gated already opts out via robots meta. */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = await getBaseUrl();
  const paths = ["/", "/methodology", "/bot", "/privacy", "/terms"];
  return paths.map((path) => ({
    url: `${base}${path}`,
    lastModified: new Date(),
  }));
}
