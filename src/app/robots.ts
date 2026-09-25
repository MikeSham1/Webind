import type { MetadataRoute } from "next";
import { isPublicLaunch } from "@/lib/gate";

// Driven by the same SITE_PUBLIC flag as next.config.ts's X-Robots-Tag header
// and the root layout's metadata — one switch to flip at launch, not three
// files to remember to edit in lockstep.
export default function robots(): MetadataRoute.Robots {
  if (!isPublicLaunch()) {
    return { rules: [{ userAgent: "*", disallow: "/" }] };
  }
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        // Account-gated areas: each also sets its own robots:noindex meta
        // (belt and suspenders), but keeping crawlers out of them here too
        // means a page that forgets its own override still isn't crawled.
        disallow: [
          "/dashboard",
          "/dashboard/*",
          "/visibility",
          "/benchmark",
          "/login",
          "/signup",
          "/forgot-password",
          "/reset-password",
          "/verify-email",
          "/splash",
          "/api/",
        ],
      },
    ],
  };
}
