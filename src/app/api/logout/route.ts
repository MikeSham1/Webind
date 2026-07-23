import { NextResponse, type NextRequest } from "next/server";
import { GATE_COOKIE } from "@/lib/gate";

/** Clear the gate cookie and return to the splash. */
export async function POST(req: NextRequest) {
  const res = NextResponse.redirect(new URL("/splash", req.nextUrl.origin), {
    status: 303,
  });
  res.cookies.set(GATE_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}
