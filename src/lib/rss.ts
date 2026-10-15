import { BRAND } from "./brand";
import Parser from "rss-parser";

export interface FeedItem {
  title: string;
  url: string;
  summary: string;
  publishedAt: Date;
}

const parser = new Parser({ timeout: 15_000 });

export function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#8217;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

export function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1).trimEnd()}…`;
}

/** Parses RSS/Atom XML into normalised items (no network). */
export async function parseFeedXml(xml: string, now: Date = new Date()): Promise<FeedItem[]> {
  const feed = await parser.parseString(xml);
  const items: FeedItem[] = [];
  for (const item of feed.items ?? []) {
    const url = item.link?.trim();
    const title = item.title ? stripHtml(item.title) : "";
    if (!url || !title) continue;
    const raw = item.contentSnippet || item.summary || item.content || "";
    const date = item.isoDate ? new Date(item.isoDate) : item.pubDate ? new Date(item.pubDate) : now;
    items.push({
      title: truncate(title, 300),
      url,
      summary: truncate(stripHtml(raw), 500),
      publishedAt: Number.isNaN(date.getTime()) ? now : date,
    });
  }
  return items;
}

export async function fetchFeed(url: string): Promise<FeedItem[]> {
  const res = await fetch(url, {
    headers: { "user-agent": `${BRAND.ecosystem}${BRAND.name}/0.1 (+rss reader)`, accept: "application/rss+xml, application/atom+xml, application/xml, text/xml" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return parseFeedXml(await res.text());
}

export const DEFAULT_FEEDS = [
  { name: "CoinDesk", url: "https://www.coindesk.com/arc/outboundfeeds/rss/" },
  { name: "The Block", url: "https://www.theblock.co/rss.xml" },
  { name: "Decrypt", url: "https://decrypt.co/feed" },
  { name: "Ledger Insights", url: "https://www.ledgerinsights.com/feed/" },
  { name: "Finextra", url: "https://www.finextra.com/rss/headlines.aspx" },
  { name: "CriptoNoticias (ES)", url: "https://www.criptonoticias.com/feed/" },
];
