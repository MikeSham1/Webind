import type { NextConfig } from "next";

/**
 * Security headers.
 *
 * This app stores WordPress application passwords, GitHub tokens and Stripe
 * customer data, and authenticates with a session cookie — so the baseline
 * browser protections below are not optional. They are deliberately the
 * framework-agnostic set that cannot break a Next app:
 *
 * - HSTS pins the browser to HTTPS after the first visit, so a later
 *   plaintext request can't be intercepted. Railway terminates TLS, so this
 *   is safe to send.
 * - frame-ancestors 'none' (and the legacy X-Frame-Options) stops the site
 *   being framed, which is what makes clickjacking a logged-in user possible.
 * - nosniff stops a response being re-interpreted as a script.
 * - Referrer-Policy keeps full URLs — which include report and draft ids —
 *   out of the Referer header sent to third parties.
 * - Permissions-Policy turns off hardware APIs the app never uses.
 *
 * A full Content-Security-Policy is NOT set here: Next injects inline
 * bootstrap scripts, so a meaningful script-src needs per-request nonces
 * threaded through the proxy, and a blanket 'unsafe-inline' policy would be
 * security theatre. frame-ancestors is enforced on its own instead, since it
 * is the directive X-Frame-Options can't fully express.
 */
const SECURITY_HEADERS = [
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  },
];

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          // PRE-LAUNCH ONLY — remove this header (and the matching rules in
          // src/app/robots.ts and the root layout's metadata) to let search
          // engines index the site. See LAUNCH.md.
          { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
          ...SECURITY_HEADERS,
        ],
      },
    ];
  },
};

export default nextConfig;
