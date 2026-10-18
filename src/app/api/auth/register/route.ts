import { registerFlow } from "@/lib/mera/flows";
import { prismaAuthDeps } from "@/lib/mera/db-deps";
import { INVITE_COOKIE, parseInviteCode } from "@/lib/invites";
import { readCookie } from "@/lib/mera/session";
import { limitIp, tooManyResponse } from "@/lib/rate-limit-server";
import { readJson, respond } from "../respond";

export const dynamic = "force-dynamic";

/** Sign up: verify a Mera Registration signature, create the profile with the wallet linked. */
export async function POST(req: Request) {
  const rl = await limitIp("authVerify", "authVerifyHourly");
  if (!rl.ok) return tooManyResponse(rl);
  // Set by /i/<code>. Used once: cleared on a successful sign-up.
  const inviteCode = parseInviteCode(readCookie(req, INVITE_COOKIE));
  const result = await registerFlow(await readJson(req), prismaAuthDeps, { inviteCode });
  const res = respond(result, "auth/register");
  if (result.ok && inviteCode) res.cookies.set(INVITE_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}
