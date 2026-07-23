import { NextResponse, type NextRequest } from "next/server";
import { GATE_COOKIE, gateToken, safeEqual, sitePassword } from "@/lib/gate";

/** Verify the shared password and, on success, set the gate cookie. */
export async function POST(req: NextRequest) {
  const form = await req.formData();
  const submitted = String(form.get("password") ?? "");
  const password = sitePassword();
  const origin = req.nextUrl.origin;

  if (!password || !safeEqual(submitted, password)) {
    return NextResponse.redirect(new URL("/splash?error=1", origin), {
      status: 303,
    });
  }

  const res = NextResponse.redirect(new URL("/", origin), { status: 303 });
  res.cookies.set(GATE_COOKIE, await gateToken(password), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30, // 30 days
  });
  return res;
}
