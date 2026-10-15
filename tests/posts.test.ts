import { describe, expect, it } from "vitest";
import { buildThread, extractMentions, flattenThread, isHelpful, isPostKind, threadIdsFor, tokenizePost, trendingScore, validatePostBody } from "@/lib/posts";

describe("validatePostBody", () => {
  it("trims, rejects empty and >320 code points", () => {
    expect(validatePostBody("  hi \r\n")).toEqual({ ok: true, body: "hi" });
    expect(validatePostBody("   ")).toEqual({ ok: false, error: "empty" });
    expect(validatePostBody("a".repeat(320)).ok).toBe(true);
    expect(validatePostBody("a".repeat(321))).toEqual({ ok: false, error: "too_long" });
    // emoji count as one character each
    expect(validatePostBody("🚀".repeat(320)).ok).toBe(true);
  });
  it("post kinds", () => {
    expect(isPostKind("hiring")).toBe(true);
    expect(isPostKind("spam")).toBe(false);
  });
});

describe("mentions & tokenizer", () => {
  it("extracts @handles but not emails", () => {
    expect(extractMentions("cc @Valeria and @tomas_r, mail me at a@b.com @valeria")).toEqual(["valeria", "tomas_r"]);
  });
  it("tokenizes orgs, users, channels and urls; unknown refs stay text", () => {
    const segs = tokenizePost("Ask @vale about $bitso in /stablecoins https://x.com/a. Also $nope and @ghost", {
      orgs: new Set(["bitso"]),
      handles: new Set(["vale"]),
      channels: new Set(["stablecoins"]),
    });
    expect(segs.filter((s) => s.type !== "text")).toEqual([
      { type: "user", value: "@vale", handle: "vale" },
      { type: "org", value: "$bitso", slug: "bitso" },
      { type: "channel", value: "/stablecoins", slug: "stablecoins" },
      { type: "url", value: "https://x.com/a" },
    ]);
    expect(segs.map((s) => s.value).join("")).toBe("Ask @vale about $bitso in /stablecoins https://x.com/a. Also $nope and @ghost");
  });
  it("does not treat path segments inside words as channels", () => {
    expect(tokenizePost("and/or 24/7", { channels: new Set(["or", "7"]) }).every((s) => s.type === "text")).toBe(true);
  });
});

describe("threads", () => {
  const t = (m: number) => new Date(2026, 9, 15, 10, m);
  const posts = [
    { id: "root", parentId: null, createdAt: t(0) },
    { id: "r2", parentId: "root", createdAt: t(5) },
    { id: "r1", parentId: "root", createdAt: t(1) },
    { id: "r1a", parentId: "r1", createdAt: t(2) },
    { id: "r1a1", parentId: "r1a", createdAt: t(3) },
    { id: "r1a1x", parentId: "r1a1", createdAt: t(4) },
    { id: "orphan", parentId: "deleted", createdAt: t(6) },
  ];
  it("threadIdsFor keeps the root stable", () => {
    expect(threadIdsFor(null)).toEqual({ parentId: null, rootId: null });
    expect(threadIdsFor({ id: "root", rootId: null })).toEqual({ parentId: "root", rootId: "root" });
    expect(threadIdsFor({ id: "r1a", rootId: "root" })).toEqual({ parentId: "r1a", rootId: "root" });
  });
  it("builds an ordered tree; orphans attach to root", () => {
    const tree = buildThread(posts, "root")!;
    expect(tree.children.map((c) => c.post.id)).toEqual(["r1", "r2", "orphan"]);
    expect(tree.children[0].children[0].post.id).toBe("r1a");
  });
  it("flattens depth-first with a depth cap", () => {
    const flat = flattenThread(buildThread(posts, "root")!, 3);
    expect(flat.map((f) => `${f.post.id}:${f.depth}`)).toEqual(["root:0", "r1:1", "r1a:2", "r1a1:3", "r1a1x:3", "r2:1", "orphan:1"]);
  });
  it("returns null for a missing root", () => {
    expect(buildThread(posts, "nope")).toBeNull();
  });
});

describe("engagement", () => {
  it("isHelpful", () => {
    expect(isHelpful({ likes: 3, recasts: 0 })).toBe(true);
    expect(isHelpful({ likes: 0, recasts: 1, replies: 1 })).toBe(true);
    expect(isHelpful({ likes: 1, recasts: 0 })).toBe(false);
  });
  it("trendingScore favours recent activity", () => {
    const now = new Date(2026, 9, 15);
    const fresh = trendingScore([now, now], 1, now);
    const old = trendingScore([new Date(2026, 8, 1), new Date(2026, 8, 1)], 1, now);
    expect(fresh).toBeGreaterThan(old);
    expect(trendingScore([], 0, now)).toBe(0);
  });
});
