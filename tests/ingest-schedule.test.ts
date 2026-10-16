import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { CHECK_EVERY_MS, INGEST_MAX_AGE_MS, __resetIngestSchedule, feedsAreStale, ingestIfStale } from "@/lib/ingest-schedule";
import { MemoryRateLimitStore } from "@/lib/rate-limit";
import type { IngestReport } from "@/lib/ingest";

const NOW = Date.UTC(2026, 9, 16, 12);

function fakePrisma(feeds: { enabled: boolean; lastFetchedAt: Date | null }[]) {
  return {
    rssFeed: {
      findFirst: vi.fn(async ({ where }: { where: { lastFetchedAt: { gt: Date } } }) => {
        const hit = feeds.find((f) => f.enabled && f.lastFetchedAt && f.lastFetchedAt > where.lastFetchedAt.gt);
        return hit ? { id: "f" } : null;
      }),
      count: vi.fn(async () => feeds.filter((f) => f.enabled).length),
    },
  } as unknown as PrismaClient;
}

const report: IngestReport = { feeds: [], created: 0, tagged: 0 };

describe("feedsAreStale", () => {
  it("is stale only when enabled feeds exist and none is recent", async () => {
    expect(await feedsAreStale(fakePrisma([]), NOW)).toBe(false);
    expect(await feedsAreStale(fakePrisma([{ enabled: true, lastFetchedAt: null }]), NOW)).toBe(true);
    expect(await feedsAreStale(fakePrisma([{ enabled: true, lastFetchedAt: new Date(NOW - INGEST_MAX_AGE_MS - 1) }]), NOW)).toBe(true);
    expect(await feedsAreStale(fakePrisma([{ enabled: true, lastFetchedAt: new Date(NOW - 60_000) }]), NOW)).toBe(false);
    expect(await feedsAreStale(fakePrisma([{ enabled: false, lastFetchedAt: null }]), NOW)).toBe(false);
  });
});

describe("ingestIfStale", () => {
  beforeEach(() => __resetIngestSchedule());

  it("runs once when stale, then waits CHECK_EVERY before looking again", async () => {
    const prisma = fakePrisma([{ enabled: true, lastFetchedAt: null }]);
    const ingest = vi.fn(async () => report);
    const store = new MemoryRateLimitStore(() => NOW);
    expect(await ingestIfStale(prisma, { now: NOW, store, ingest })).toBe("ran");
    expect(await ingestIfStale(prisma, { now: NOW + 1000, store, ingest })).toBe("skipped");
    expect(ingest).toHaveBeenCalledTimes(1);
  });

  it("does nothing when feeds are fresh", async () => {
    const ingest = vi.fn(async () => report);
    const prisma = fakePrisma([{ enabled: true, lastFetchedAt: new Date(NOW - 1000) }]);
    expect(await ingestIfStale(prisma, { now: NOW, store: new MemoryRateLimitStore(() => NOW), ingest })).toBe("fresh");
    expect(ingest).not.toHaveBeenCalled();
  });

  it("lets only one instance claim a run per window (shared store)", async () => {
    const prisma = fakePrisma([{ enabled: true, lastFetchedAt: null }]);
    const ingest = vi.fn(async () => report);
    const shared = new MemoryRateLimitStore(() => NOW);
    expect(await ingestIfStale(prisma, { now: NOW, store: shared, ingest })).toBe("ran");
    __resetIngestSchedule(); // a second instance has its own memory but the same claim store
    expect(await ingestIfStale(prisma, { now: NOW + CHECK_EVERY_MS, store: shared, ingest })).toBe("claimed_elsewhere");
    expect(ingest).toHaveBeenCalledTimes(1);
  });
});
