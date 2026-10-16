import "server-only";
import { NextResponse } from "next/server";
import { logger } from "@/lib/log";
import type { FlowResult } from "@/lib/mera/flows";
import { issueSession, sessionCookieHeader } from "@/lib/mera/session";

/** Turn a flow result into a response, minting the Mera session cookie on success. */
export function respond(result: FlowResult, route: string) {
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  let token: string;
  try {
    token = issueSession(result.wallet, result.credentialId);
  } catch (e) {
    logger.error("AUTH_SESSION_SECRET is not configured", { scope: "auth", route, err: e instanceof Error ? e.message : String(e) });
    return NextResponse.json({ error: "Mera sign-in is not configured on this server (AUTH_SESSION_SECRET)." }, { status: 503 });
  }
  return NextResponse.json(
    { authenticated: true, user: { handle: result.user.handle, walletAddress: result.wallet } },
    { status: result.status, headers: { "set-cookie": sessionCookieHeader(token), "cache-control": "no-store" } },
  );
}

export async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    // Intentional: a malformed body is the client's problem; callers answer 400.
    return null;
  }
}
