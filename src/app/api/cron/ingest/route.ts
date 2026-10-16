import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { ingestAllFeeds } from "@/lib/ingest";

export const dynamic = "force-dynamic";

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 32) return false;
  const got = Buffer.from(req.headers.get("authorization") ?? "");
  const want = Buffer.from(`Bearer ${secret}`);
  return got.length === want.length && timingSafeEqual(got, want);
}

/**
 * Optional: lets an external scheduler (a Railway cron service, GitHub Actions, ...) refresh
 * the public news feeds. Off unless CRON_SECRET (32+ chars) is set; 404 otherwise.
 * Not needed by default: feeds refresh lazily when people visit (src/lib/ingest-schedule.ts).
 */
export async function POST(req: Request) {
  if (!authorized(req)) return new NextResponse("Not found", { status: 404 });
  const r = await ingestAllFeeds(prisma);
  return NextResponse.json({ created: r.created, tagged: r.tagged, feeds: r.feeds.length });
}
