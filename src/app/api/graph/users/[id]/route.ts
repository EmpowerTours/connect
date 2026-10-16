import { NextResponse } from "next/server";
import { listEvents, parsePage, protocolInfo, resolveWallet, userGraph } from "@/lib/graph/public";

export const dynamic = "force-dynamic";

const PUBLIC = { "access-control-allow-origin": "*", "cache-control": "public, max-age=15" };

/**
 * Public, read-only: one member's graph (handle or wallet) derived from signed
 * updates only, plus a page of the updates they signed.
 *   GET /api/graph/users/<handle|wallet>?cursor=<id>&limit=<1-100>
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const who = await resolveWallet((await params).id);
  if (!who) return NextResponse.json({ error: "no signed graph for this member" }, { status: 404, headers: PUBLIC });
  const page = parsePage(new URL(req.url).searchParams);
  const [graph, events] = await Promise.all([userGraph(who.wallet), listEvents({ ...page, author: who.wallet })]);
  return NextResponse.json({ protocol: protocolInfo(), member: who, graph, events: events.events, nextCursor: events.nextCursor }, { headers: PUBLIC });
}
