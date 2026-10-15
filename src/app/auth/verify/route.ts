import { NextResponse, type NextRequest } from "next/server";

/** Email magic links are retired: sign-in is Mera passkey only. Old links land on /login. */
export function GET(req: NextRequest) {
  return NextResponse.redirect(new URL("/login?error=link", req.url));
}
