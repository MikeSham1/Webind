import type { MetadataRoute } from "next";

// Pre-launch: disallow all crawling. Replace with real rules at public launch.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", disallow: "/" }],
  };
}
