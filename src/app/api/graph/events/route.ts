import { NextResponse } from "next/server";
import { listEvents, parsePage, protocolInfo, resolveWallet } from "@/lib/graph/public";

export const dynamic = "force-dynamic";

const PUBLIC = { "access-control-allow-origin": "*", "cache-control": "public, max-age=15" };

/**
 * Public, read-only: the signed graph log, oldest first.
 *   GET /api/graph/events?cursor=<id>&limit=<1-100>[&author=<wallet|handle>]
 * Every event carries its signature and is re-verified on the way out ("valid").
 */
export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const page = parsePage(params);
  let author: string | undefined;
  const who = params.get("author");
  if (who) {
    const r = await resolveWallet(who);
    if (!r) return NextResponse.json({ error: "unknown author" }, { status: 404, headers: PUBLIC });
    author = r.wallet;
  }
  const { events, nextCursor } = await listEvents({ ...page, author });
  return NextResponse.json({ protocol: protocolInfo(), events, nextCursor }, { headers: PUBLIC });
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: { ...PUBLIC, "access-control-allow-methods": "GET, OPTIONS" } });
}
