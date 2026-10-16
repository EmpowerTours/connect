import { NextResponse } from "next/server";
import { limitIp, tooManyResponse } from "@/lib/rate-limit-server";
import { newNonce } from "@/lib/mera/session";
import { APP_DOMAIN, LINK_STATEMENT, SESSION_STATEMENT } from "@/lib/mera/typed-data";
import { CLOCK_SKEW_SECONDS } from "@/lib/mera/verify";

export const dynamic = "force-dynamic";

/** A fresh challenge for the browser to sign. Single use is enforced on verify. */
export async function GET() {
  const rl = await limitIp("authNonce");
  if (!rl.ok) return tooManyResponse(rl);
  return NextResponse.json(
    {
      nonce: newNonce(),
      serverTs: Math.floor(Date.now() / 1000),
      clockSkewSeconds: CLOCK_SKEW_SECONDS,
      domain: APP_DOMAIN,
      sessionStatement: SESSION_STATEMENT,
      linkStatement: LINK_STATEMENT,
    },
    { headers: { "cache-control": "no-store" } },
  );
}
