import type { MetadataRoute } from "next";
import { getBaseUrl } from "@/lib/baseUrl";
import { isPublicLaunch } from "@/lib/gate";

// getBaseUrl() reads request headers, which needs a real request context.
export const dynamic = "force-dynamic";

/**
 * Public, indexable pages only — everything auth-gated already opts out via
 * robots meta and robots.ts. Empty pre-launch to match robots.ts's blanket
 * disallow: a sitemap listing pages robots.txt says not to crawl is just
 * confusing, not harmful, but there's no reason to publish one yet.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  if (!isPublicLaunch()) return [];

  const base = await getBaseUrl();
  const paths = [
    "/",
    "/pricing",
    "/compare",
    "/studio",
    "/site-report",
    "/methodology",
    "/bot",
    "/privacy",
    "/terms",
  ];
  return paths.map((path) => ({
    url: `${base}${path}`,
    lastModified: new Date(),
  }));
}
