import type { NextConfig } from "next";
// Relative, not the "@/" alias: next.config.ts loads outside the app's normal
// module resolution, before tsconfig paths are wired up.
import { isPublicLaunch } from "./src/lib/gate";

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
 * On the Content-Security-Policy below, being precise about what it does and
 * does not buy:
 *
 * Every directive except script-src/style-src is strict. object-src 'none'
 * and base-uri 'self' close two injection routes that are easy to forget (a
 * planted <object>, and a <base> tag that silently re-points every relative
 * URL on the page). form-action 'self' stops an injected form posting
 * credentials elsewhere — safe here because Stripe checkout is a fetch() plus
 * a JS navigation, not a cross-origin form POST. default-src 'self' means a
 * script, frame or connection to an attacker's origin is refused outright.
 *
 * script-src keeps 'unsafe-inline' because the honest alternative is worse.
 * Locking it down requires a per-request nonce, and Next only supports that
 * under dynamic rendering — which would force /methodology, /privacy, /terms
 * and /bot off static rendering. Deliberately trading away the static
 * performance of the marketing pages, on a product that sells page
 * experience, to gain a partial XSS defense is the wrong trade. So this
 * blocks externally-hosted scripts (real, and the common injection vector)
 * but not inline ones. Revisit if those pages ever need to be dynamic anyway.
 */
const CSP = [
  "default-src 'self'",
  // 'unsafe-eval' is dev-only: React uses eval to rebuild server stack traces.
  `script-src 'self' 'unsafe-inline'${process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""}`,
  // Inline style ATTRIBUTES (React's style={{…}}) cannot carry a nonce, and
  // the app uses them for its animations. Styles are a far lower risk than
  // scripts, so this is allowed rather than pretending otherwise.
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "frame-src 'none'",
].join("; ");
const SECURITY_HEADERS = [
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: CSP },
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
          // Pre-launch lock, driven by the same SITE_PUBLIC flag as robots.ts,
          // sitemap.ts, and the root layout's metadata — one switch to flip at
          // launch instead of several files to remember to edit. See LAUNCH.md.
          ...(isPublicLaunch()
            ? []
            : [{ key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" }]),
          ...SECURITY_HEADERS,
        ],
      },
    ];
  },
};

export default nextConfig;
