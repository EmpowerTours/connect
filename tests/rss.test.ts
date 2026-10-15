import { describe, expect, it } from "vitest";
import { parseFeedXml, stripHtml, truncate } from "@/lib/rss";

const RSS = `<?xml version="1.0"?><rss version="2.0"><channel><title>T</title>
<item><title>Bitso &amp; partners expand MXNB</title><link>https://example.com/a</link><pubDate>Wed, 14 Oct 2026 10:00:00 GMT</pubDate><description><![CDATA[<p>Peso <b>stablecoin</b> news</p>]]></description></item>
<item><title>No link item</title></item>
<item><title>Bad date</title><link>https://example.com/b</link><pubDate>not a date</pubDate></item>
</channel></rss>`;

const ATOM = `<?xml version="1.0" encoding="utf-8"?><feed xmlns="http://www.w3.org/2005/Atom"><title>A</title>
<entry><title>Atom entry</title><link href="https://example.com/atom"/><updated>2026-10-13T08:00:00Z</updated><summary>Summary here</summary></entry></feed>`;

describe("parseFeedXml", () => {
  it("parses RSS items, strips HTML, skips items without links, falls back on bad dates", async () => {
    const now = new Date("2026-10-15T00:00:00Z");
    const items = await parseFeedXml(RSS, now);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ title: "Bitso & partners expand MXNB", url: "https://example.com/a", summary: "Peso stablecoin news" });
    expect(items[0].publishedAt.toISOString()).toBe("2026-10-14T10:00:00.000Z");
    expect(items[1].publishedAt).toEqual(now);
  });
  it("parses Atom", async () => {
    const items = await parseFeedXml(ATOM);
    expect(items[0]).toMatchObject({ title: "Atom entry", url: "https://example.com/atom" });
  });
});

describe("helpers", () => {
  it("stripHtml and truncate", () => {
    expect(stripHtml("<p>a&nbsp;&amp; b</p>")).toBe("a & b");
    expect(truncate("abcdef", 4)).toBe("abc…");
    expect(truncate("abc", 4)).toBe("abc");
  });
});
