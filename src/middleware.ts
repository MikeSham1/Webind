import { NextResponse, type NextRequest } from "next/server";
import { GATE_COOKIE, gateToken, safeEqual, sitePassword } from "@/lib/gate";

// Reachable without the password: the splash itself and its auth endpoints.
const PUBLIC_PATHS = ["/splash", "/api/login", "/api/logout"];

export async function middleware(req: NextRequest) {
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
  // Middleware runs in the edge runtime, whose nextUrl reflects the proxy's
  // public host — so an absolute redirect here is correct (and middleware
  // rejects a relative Location). The Node-runtime route handlers, which do see
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
