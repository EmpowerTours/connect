import type { PrismaClient } from "@prisma/client";
import { fetchFeed, type FeedItem } from "./rss";
import { matchOrgs } from "./tagging";

export interface IngestReport {
  feeds: { name: string; fetched: number; created: number; error?: string }[];
  created: number;
  tagged: number;
}

/** Stores new items and tags them to orgs by name/alias match. Idempotent on URL. */
export async function storeItems(
  prisma: PrismaClient,
  sourceName: string,
  items: FeedItem[],
): Promise<{ created: number; tagged: number }> {
  const orgs = await prisma.organization.findMany({ select: { id: true, name: true, aliases: true } });
  let created = 0;
  let tagged = 0;
  for (const item of items) {
    const exists = await prisma.signal.findUnique({ where: { url: item.url }, select: { id: true } });
    if (exists) continue;
    const matches = matchOrgs(`${item.title}\n${item.summary}`, orgs);
    await prisma.signal.create({
      data: {
        source: "rss",
        sourceName,
        title: item.title,
        url: item.url,
        summary: item.summary,
        publishedAt: item.publishedAt,
        orgs: { create: matches.map((o) => ({ orgId: o.id })) },
      },
    });
    created += 1;
    if (matches.length) tagged += 1;
  }
  return { created, tagged };
}

export async function ingestAllFeeds(prisma: PrismaClient, fetcher = fetchFeed): Promise<IngestReport> {
  const feeds = await prisma.rssFeed.findMany({ where: { enabled: true } });
  const report: IngestReport = { feeds: [], created: 0, tagged: 0 };
  for (const feed of feeds) {
    try {
      const items = await fetcher(feed.url);
      const res = await storeItems(prisma, feed.name, items);
      report.feeds.push({ name: feed.name, fetched: items.length, created: res.created });
      report.created += res.created;
      report.tagged += res.tagged;
      await prisma.rssFeed.update({ where: { id: feed.id }, data: { lastFetchedAt: new Date(), lastError: null } });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      report.feeds.push({ name: feed.name, fetched: 0, created: 0, error: message });
      await prisma.rssFeed.update({ where: { id: feed.id }, data: { lastError: message } });
    }
  }
  return report;
}
