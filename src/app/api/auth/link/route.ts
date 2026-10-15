import { getCurrentUser } from "@/lib/auth";
import { linkFlow } from "@/lib/mera/flows";
import { prismaAuthDeps } from "@/lib/mera/db-deps";
import { readJson, respond } from "../respond";

export const dynamic = "force-dynamic";

/** Link a Mera wallet to the signed-in profile (e.g. the local demo user). */
export async function POST(req: Request) {
  const user = await getCurrentUser();
  const current = user ? { id: user.id, handle: user.handle, walletAddress: user.walletAddress } : null;
  return respond(await linkFlow(await readJson(req), current, prismaAuthDeps), "auth/link");
}
