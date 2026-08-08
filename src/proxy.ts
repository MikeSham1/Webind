import { NextResponse, type NextRequest } from "next/server";
import { GATE_COOKIE, gateToken, safeEqual, sitePassword } from "@/lib/gate";

// Reachable without the password: the splash itself, its auth endpoints, and
// the container-orchestration health checks (Railway can't send our gate
// cookie, and a redirect-to-splash would defeat the point of a health probe —
// neither endpoint reveals anything sensitive).
const PUBLIC_PATHS = ["/splash", "/api/login", "/api/logout", "/api/health", "/api/ready"];

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
