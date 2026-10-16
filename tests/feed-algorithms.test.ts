import { describe, expect, it } from "vitest";
import {
  BAIT_PATTERN,
  DEFAULT_FEED_ALGORITHM,
  baitRatio,
  conversations,
  getFeedAlgorithm,
  highSignal,
  isMuted,
  listFeedAlgorithms,
  noBait,
  rankFeed,
  recency,
  registerFeedAlgorithm,
  resolveFeedAlgorithm,
  sanitizeMutes,
  topicsOf,
  type FeedCandidate,
  type FeedMutes,
} from "@/lib/feed-algorithms";

const now = new Date("2026-10-16T12:00:00Z");
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000);
const ctx = { now, viewerId: "me" };
const none: FeedMutes = { topics: new Set(), channels: new Set() };

function c(over: Partial<FeedCandidate> & { key: string }): FeedCandidate {
  return {
    postId: over.key,
    authorId: "a",
    createdAt: hoursAgo(1),
    body: "Quarterly update on our settlement pilot.",
    kind: "",
    channelSlug: null,
    isRepost: false,
    replies: 0,
    repliers: 0,
    likes: 0,
    reposts: 0,
    quotes: 0,
    authorVerifiedMember: false,
    authorWalletVerified: false,
    ...over,
  };
}
const keys = (xs: FeedCandidate[]) => xs.map((x) => x.key);

describe("feed algorithm registry", () => {
  it("ships the four built-ins with EN and ES labels", () => {
    expect(listFeedAlgorithms().map((a) => a.id)).toEqual(["latest", "high_signal", "conversations", "no_bait"]);
    for (const a of listFeedAlgorithms()) for (const loc of ["en", "es"] as const) {
      expect(a.label[loc].trim()).not.toBe("");
      expect(a.description[loc].trim()).not.toBe("");
    }
  });
  it("accepts a plugin and rejects bad ids, duplicates and missing translations", () => {
    registerFeedAlgorithm({ id: "test_oldest", label: { en: "Oldest", es: "Antiguos" }, description: { en: "x", es: "x" }, score: (x) => -x.createdAt.getTime() });
    expect(getFeedAlgorithm("test_oldest").id).toBe("test_oldest");
    expect(() => registerFeedAlgorithm({ ...conversations })).toThrow(/already/);
    expect(() => registerFeedAlgorithm({ ...conversations, id: "Bad Id" })).toThrow(/invalid/);
    expect(() => registerFeedAlgorithm({ ...conversations, id: "no_es", label: { en: "x", es: " " } })).toThrow(/es label/);
  });
  it("resolves explicit pick > channel default > saved > latest, ignoring unknown ids", () => {
    expect(resolveFeedAlgorithm({}).id).toBe(DEFAULT_FEED_ALGORITHM);
    expect(resolveFeedAlgorithm({ saved: "no_bait" }).id).toBe("no_bait");
    expect(resolveFeedAlgorithm({ saved: "no_bait", channelDefault: "conversations" }).id).toBe("conversations");
    expect(resolveFeedAlgorithm({ requested: "high_signal", channelDefault: "conversations", saved: "no_bait" }).id).toBe("high_signal");
    expect(resolveFeedAlgorithm({ requested: "nope", saved: "also-nope" }).id).toBe("latest");
    expect(getFeedAlgorithm("nope").id).toBe("latest");
  });
});

describe("built-in algorithms", () => {
  it("latest is pure reverse-chronological", () => {
    const out = rankFeed([c({ key: "old", createdAt: hoursAgo(9), replies: 50 }), c({ key: "new", createdAt: hoursAgo(1) })], getFeedAlgorithm("latest"), ctx, none, 10);
    expect(keys(out)).toEqual(["new", "old"]);
  });
  it("high-signal keeps only approved org members (and the viewer)", () => {
    const out = rankFeed(
      [c({ key: "anon" }), c({ key: "member", authorVerifiedMember: true }), c({ key: "mine", authorId: "me" })],
      highSignal,
      ctx,
      none,
      10,
    );
    expect(keys(out).sort()).toEqual(["member", "mine"]);
  });
  it("conversations ranks real back-and-forth above likes", () => {
    const out = rankFeed(
      [
        c({ key: "liked", likes: 40 }),
        c({ key: "thread", replies: 6, repliers: 4, createdAt: hoursAgo(8) }),
        c({ key: "quiet" }),
      ],
      conversations,
      ctx,
      none,
      10,
    );
    expect(keys(out)).toEqual(["thread", "liked", "quiet"]);
  });
  it("conversations counts people, not reply volume", () => {
    const twoPeople = conversations.score(c({ key: "a", replies: 10, repliers: 2 }), ctx)!;
    const sixPeople = conversations.score(c({ key: "b", replies: 6, repliers: 6 }), ctx)!;
    expect(sixPeople).toBeGreaterThan(twoPeople);
  });
  it("no bait sinks lopsided engagement, bait phrases and reposts", () => {
    const out = rankFeed(
      [
        c({ key: "bait", body: "RT if you are bullish on stablecoins", createdAt: hoursAgo(0.5) }),
        c({ key: "farmed", likes: 120, reposts: 40, createdAt: hoursAgo(0.5) }),
        c({ key: "repost", isRepost: true, createdAt: hoursAgo(0.5) }),
        c({ key: "honest", likes: 4, replies: 3, createdAt: hoursAgo(2) }),
      ],
      noBait,
      ctx,
      none,
      10,
    );
    expect(keys(out)[0]).toBe("honest");
    expect(keys(out).at(-1)).toBe("farmed");
    expect(baitRatio({ likes: 3, reposts: 0, replies: 1 })).toBeLessThan(1);
    expect(BAIT_PATTERN.test("Giveaway! Follow me and tag 3 friends")).toBe(true);
    expect(BAIT_PATTERN.test("We follow the travel rule in every corridor.")).toBe(false);
  });
  it("recency decays smoothly", () => {
    expect(recency(now, now)).toBe(1);
    expect(recency(hoursAgo(24), now)).toBeCloseTo(0.354, 2);
    expect(recency(hoursAgo(96), now)).toBeLessThan(0.1);
  });
});

describe("mutes", () => {
  it("detects topics from the channel and the text", () => {
    expect([...topicsOf({ channelSlug: "latam-payments", body: "hello" })].sort()).toEqual(["payments", "remittances"]);
    expect(topicsOf({ channelSlug: null, body: "Our USDC corridor to PIX" }).has("stablecoins")).toBe(true);
    expect(topicsOf({ channelSlug: null, body: "Hiring a designer" }).size).toBe(0);
  });
  it("hides muted topics and channels from every algorithm, never your own posts", () => {
    const mutes: FeedMutes = { topics: new Set(["stablecoins"]), channels: new Set(["custody"]) };
    const items = [
      c({ key: "stable", body: "New stablecoin issuer in Brazil" }),
      c({ key: "custody", channelSlug: "custody" }),
      c({ key: "mine", authorId: "me", body: "My stablecoin take" }),
      c({ key: "ok" }),
    ];
    for (const a of listFeedAlgorithms().filter((x) => x.id !== "high_signal")) {
      expect(keys(rankFeed(items, a, ctx, mutes, 10)).sort()).toEqual(["mine", "ok"]);
    }
    expect(isMuted(items[0], none, "me")).toBe(false);
  });
  it("sanitizes mute input", () => {
    expect(sanitizeMutes({ topics: ["payments", "payments", "politics"], channels: ["custody", "nope"] }, new Set(["custody"]))).toEqual({
      topics: ["payments"],
      channels: ["custody"],
    });
  });
  it("respects take and keeps ties stable", () => {
    const same = hoursAgo(3);
    const out = rankFeed([c({ key: "b", createdAt: same }), c({ key: "a", createdAt: same })], getFeedAlgorithm("latest"), ctx, none, 1);
    expect(keys(out)).toEqual(["a"]);
  });
});
