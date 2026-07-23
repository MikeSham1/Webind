import { NextResponse } from "next/server";
import { GATE_COOKIE } from "@/lib/gate";

/** Clear the gate cookie and return to the splash (relative, proxy-safe). */
export async function POST() {
  const res = new NextResponse(null, {
    status: 303,
    headers: { Location: "/splash" },
  });
  res.cookies.set(GATE_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}
