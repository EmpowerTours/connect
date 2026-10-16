import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { preparePending } from "@/lib/graph/server";

export const dynamic = "force-dynamic";

/** The signed-in member's unsigned graph updates, ready to sign (consecutive seqs, fresh issuedAt). */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "sign in first" }, { status: 401, headers: { "cache-control": "no-store" } });
  const p = await preparePending(user);
  if (!p) return NextResponse.json({ error: "link your Mera wallet first" }, { status: 409, headers: { "cache-control": "no-store" } });
  return NextResponse.json(p, { headers: { "cache-control": "no-store" } });
}
