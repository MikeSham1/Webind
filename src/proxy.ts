import { NextResponse, type NextRequest } from "next/server";
import { GATE_COOKIE, gateToken, safeEqual, sitePassword } from "@/lib/gate";

// Reachable without the password: the splash itself, its auth endpoints, the
// container-orchestration health checks, and the cron cleanup endpoint.
// None of these can send our gate cookie (a health prober or an external
// scheduler isn't a browser with our cookie jar), and a redirect-to-splash
// would defeat their purpose. Neither health endpoint reveals anything
// sensitive, and the cron endpoint is independently protected by its own
// CRON_SECRET bearer token — this list only controls whether the gate's
// password applies, not whether the route itself is protected.
const PUBLIC_PATHS = [
  "/splash",
  "/api/login",
  "/api/logout",
  "/api/health",
  "/api/ready",
  "/api/cron",
];

/**
 * Pre-launch password gate.
 *
 * Next.js 16 renamed Middleware to Proxy: the file must be `proxy.ts` and the
 * export must be `proxy`. The behaviour is unchanged, but the old
 * `middleware.ts` convention is deprecated, so this is the supported spelling.
 */
export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return NextResponse.next();
  }

  const password = sitePassword();
  if (password) {
    const cookie = req.cookies.get(GATE_COOKIE)?.value ?? "";
    const expected = await gateToken(password);
    if (safeEqual(cookie, expected)) return NextResponse.next();
  }

  // Not authenticated (or password unconfigured → fail closed): send to splash.
  // Proxy runs in the edge runtime, whose nextUrl reflects the public host —
  // so an absolute redirect here is correct (and the proxy layer rejects a
  // relative Location). The Node-runtime route handlers, which do see
  // the internal 0.0.0.0 origin, use relative redirects instead.
  const url = req.nextUrl.clone();
  url.pathname = "/splash";
  url.search = "";
  return NextResponse.redirect(url);
}

export const config = {
  // Run on everything except Next internals and static asset files (which
  // includes /robots.txt, so crawlers can still read the disallow rules).
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt|xml)).*)",
  ],
};
