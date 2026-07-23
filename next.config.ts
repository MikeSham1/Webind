import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        // Pre-launch: tell every crawler not to index anything, on every route
        // (belt-and-suspenders alongside robots.txt and the <meta robots> tag).
        source: "/:path*",
        headers: [
          { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
        ],
      },
    ];
  },
};

export default nextConfig;
