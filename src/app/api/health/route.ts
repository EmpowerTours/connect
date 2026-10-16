import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/log";

export const dynamic = "force-dynamic";

/** Railway healthcheck: the process is up and the database answers. No details leak. */
export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({ ok: true }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    logger.error("health check: database unreachable", { scope: "health", err: e });
    return NextResponse.json({ ok: false }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
