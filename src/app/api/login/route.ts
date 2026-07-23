import { NextResponse, type NextRequest } from "next/server";
import { GATE_COOKIE, gateToken, safeEqual, sitePassword } from "@/lib/gate";

/**
 * Verify the shared password and, on success, set the gate cookie.
 *
 * Redirects use a RELATIVE Location so the browser resolves them against the
 * public URL in its address bar. Building an absolute URL from the request
 * origin breaks behind a reverse proxy (e.g. Railway), where the origin is the
 * container's internal address like http://0.0.0.0:8080.
 */
export async function POST(req: NextRequest) {
  const form = await req.formData();
  const submitted = String(form.get("password") ?? "");
  const password = sitePassword();

  if (!password || !safeEqual(submitted, password)) {
    return new NextResponse(null, {
      status: 303,
      headers: { Location: "/splash?error=1" },
    });
  }

  const res = new NextResponse(null, {
    status: 303,
    headers: { Location: "/" },
  });
  res.cookies.set(GATE_COOKIE, await gateToken(password), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30, // 30 days
  });
  return res;
}
