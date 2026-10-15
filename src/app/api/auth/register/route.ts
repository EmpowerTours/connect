import { registerFlow } from "@/lib/mera/flows";
import { prismaAuthDeps } from "@/lib/mera/db-deps";
import { readJson, respond } from "../respond";

export const dynamic = "force-dynamic";

/** Sign up: verify a Mera Registration signature, create the profile with the wallet linked. */
export async function POST(req: Request) {
  return respond(await registerFlow(await readJson(req), prismaAuthDeps), "auth/register");
}
