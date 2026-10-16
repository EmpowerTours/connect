import { NextResponse } from "next/server";
import { getCurrentAuth } from "@/lib/auth";
import { loginFlow } from "@/lib/mera/flows";
import { prismaAuthDeps } from "@/lib/mera/db-deps";
import { clearSessionCookieHeader } from "@/lib/mera/session";
import { limitIp, tooManyResponse } from "@/lib/rate-limit-server";
import { readJson, respond } from "../respond";

export const dynamic = "force-dynamic";

/** Sign in: verify a Mera Session signature, mint the session cookie. 404 = sign up first. */
export async function POST(req: Request) {
  const rl = await limitIp("authVerify", "authVerifyHourly");
  if (!rl.ok) return tooManyResponse(rl);
  return respond(await loginFlow(await readJson(req), prismaAuthDeps), "auth/session");
}

/** Who am I. */
export async function GET() {
  const auth = await getCurrentAuth();
  if (!auth) return NextResponse.json({ authenticated: false }, { status: 401, headers: { "cache-control": "no-store" } });
  return NextResponse.json(
    { authenticated: true, method: auth.method, user: { handle: auth.user.handle, walletAddress: auth.user.walletAddress, walletVerified: auth.user.walletVerified } },
    { headers: { "cache-control": "no-store" } },
  );
}

/** Sign out (Mera cookie). The demo cookie is cleared by logoutAction. */
export function DELETE() {
  return NextResponse.json({ authenticated: false }, { headers: { "set-cookie": clearSessionCookieHeader() } });
}
