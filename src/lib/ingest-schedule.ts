/**
 * Keeping public news fresh without a cron service: when someone opens Today or Signals and
 * the feeds are older than INGEST_MAX_AGE, one background ingest runs after the response.
 * Costs nothing when nobody is looking. Guards:
 *   - each instance checks the database at most every CHECK_EVERY;
 *   - a shared "claim" (Redis when configured) lets only one run start per CLAIM_WINDOW.
 * Admins can still refresh by hand on /signals, and POST /api/cron/ingest (CRON_SECRET)
 * exists for an external scheduler if ever wanted.
 */
import type { PrismaClient } from "@prisma/client";
import { ingestAllFeeds, type IngestReport } from "./ingest";
import { checkLimit, defaultRateLimitStore, type RateLimitStore } from "./rate-limit";

export const INGEST_MAX_AGE_MS = 6 * 60 * 60 * 1000;
export const CHECK_EVERY_MS = 10 * 60 * 1000;

let lastCheck = 0;
let running = false;

/** True when no enabled feed has been fetched within maxAge. */
export async function feedsAreStale(prisma: Pick<PrismaClient, "rssFeed">, now = Date.now(), maxAge = INGEST_MAX_AGE_MS): Promise<boolean> {
  const fresh = await prisma.rssFeed.findFirst({ where: { enabled: true, lastFetchedAt: { gt: new Date(now - maxAge) } }, select: { id: true } });
  if (fresh) return false;
  return (await prisma.rssFeed.count({ where: { enabled: true } })) > 0;
}

export async function ingestIfStale(
  prisma: PrismaClient,
  opts: { now?: number; store?: RateLimitStore; ingest?: (p: PrismaClient) => Promise<IngestReport> } = {},
): Promise<"skipped" | "fresh" | "claimed_elsewhere" | "ran"> {
  const now = opts.now ?? Date.now();
  if (running || now - lastCheck < CHECK_EVERY_MS) return "skipped";
  lastCheck = now;
  if (!(await feedsAreStale(prisma, now))) return "fresh";
  const claim = await checkLimit(opts.store ?? defaultRateLimitStore(), "ingestClaim", "global", now);
  if (!claim.ok) return "claimed_elsewhere";
  running = true;
  try {
    await (opts.ingest ?? ingestAllFeeds)(prisma);
    return "ran";
  } finally {
    running = false;
  }
}

/** Test seam. */
export function __resetIngestSchedule(): void {
  lastCheck = 0;
  running = false;
}
