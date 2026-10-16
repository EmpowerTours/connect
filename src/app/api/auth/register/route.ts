import { registerFlow } from "@/lib/mera/flows";
import { prismaAuthDeps } from "@/lib/mera/db-deps";
import { limitIp, tooManyResponse } from "@/lib/rate-limit-server";
import { readJson, respond } from "../respond";

export const dynamic = "force-dynamic";

/** Sign up: verify a Mera Registration signature, create the profile with the wallet linked. */
export async function POST(req: Request) {
  const rl = await limitIp("authVerify", "authVerifyHourly");
  if (!rl.ok) return tooManyResponse(rl);
  return respond(await registerFlow(await readJson(req), prismaAuthDeps), "auth/register");
}
