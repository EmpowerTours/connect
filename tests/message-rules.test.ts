import { describe, expect, it } from "vitest";
import {
  CLOCK_SKEW_SECONDS,
  isWellFormedUtf16,
  validateEmbed,
  validatePostAddBody,
  validateTimestamp,
  validateUrl,
  type PostAddBody,
} from "@/lib/protocol/message-rules";
import { extractMentions, validatePostBody } from "@/lib/posts";

const H = `0x${"ab".repeat(32)}`;
const base = (o: Partial<PostAddBody> = {}): PostAddBody => ({ text: "hello", embeds: [], mentions: [], mentionsPositions: [], ...o });
const err = (r: { ok: boolean; error?: string }) => (r.ok ? null : r.error);

describe("message rules (Farcaster-derived)", () => {
  it("accepts a normal post", () => expect(validatePostAddBody(base()).ok).toBe(true));

  it("counts text in code points, max 320", () => {
    expect(validatePostAddBody(base({ text: "😀".repeat(320) })).ok).toBe(true);
    expect(err(validatePostAddBody(base({ text: "a".repeat(321) })))).toMatch(/> 320/);
  });

  it("rejects lone surrogates", () => {
    expect(isWellFormedUtf16("ok 😀")).toBe(true);
    expect(isWellFormedUtf16("bad \ud800")).toBe(false);
    expect(isWellFormedUtf16("\udc00")).toBe(false);
    expect(err(validatePostAddBody(base({ text: "x\ud800" })))).toMatch(/utf8/);
  });

  it("rejects an empty post but allows embed-only", () => {
    expect(err(validatePostAddBody(base({ text: "" })))).toBe("post is empty");
    expect(validatePostAddBody(base({ text: "", embeds: [{ url: "https://a.co" }] })).ok).toBe(true);
  });

  it("caps embeds at 2 and validates each", () => {
    const e = { url: "https://a.co" };
    expect(err(validatePostAddBody(base({ embeds: [e, e, e] })))).toBe("embeds > 2");
    expect(err(validatePostAddBody(base({ embeds: [{ url: "javascript:alert(1)" }] })))).toMatch(/http/);
    expect(validateEmbed({ ref: { id: BigInt(1), hash: H } }).ok).toBe(true);
    expect(validateEmbed({ ref: { id: BigInt(0), hash: H } }).ok).toBe(false);
    expect(validateEmbed({ ref: { id: BigInt(1), hash: "0x12" } }).ok).toBe(false);
    expect(validateEmbed({} as never).ok).toBe(false);
  });

  it("limits URLs to 1..256 bytes", () => {
    expect(validateUrl("").ok).toBe(false);
    expect(validateUrl(`https://a.co/${"x".repeat(243)}`).ok).toBe(true);
    expect(validateUrl(`https://a.co/${"x".repeat(244)}`).ok).toBe(false);
    expect(validateUrl("not a url").ok).toBe(false);
  });

  it("checks mentions: max 10, matching, in range, ascending", () => {
    const ids = (n: number) => Array.from({ length: n }, (_, i) => BigInt(i + 1));
    expect(validatePostAddBody(base({ mentions: ids(10), mentionsPositions: Array(10).fill(0) })).ok).toBe(true);
    expect(err(validatePostAddBody(base({ mentions: ids(11), mentionsPositions: Array(11).fill(0) })))).toBe("mentions > 10");
    expect(err(validatePostAddBody(base({ mentions: ids(1), mentionsPositions: [] })))).toMatch(/must match/);
    expect(err(validatePostAddBody(base({ mentions: ids(1), mentionsPositions: [6] })))).toMatch(/position in text/);
    expect(err(validatePostAddBody(base({ mentions: ids(2), mentionsPositions: [3, 1] })))).toMatch(/ascending/);
    expect(err(validatePostAddBody(base({ mentions: [BigInt(0)], mentionsPositions: [0] })))).toMatch(/mention id/);
    expect(err(validatePostAddBody(base({ mentions: ids(1), mentionsPositions: [1.5] })))).toMatch(/integers/);
  });

  it("rejects parent together with channel", () => {
    expect(validatePostAddBody(base({ parent: { id: BigInt(2), hash: H } })).ok).toBe(true);
    expect(err(validatePostAddBody(base({ parent: { id: BigInt(2), hash: H }, channel: "x" })))).toMatch(/both parent/);
  });

  it("allows at most 10 minutes of clock skew", () => {
    expect(validateTimestamp(1000 + CLOCK_SKEW_SECONDS, 1000).ok).toBe(true);
    expect(validateTimestamp(1001 + CLOCK_SKEW_SECONDS, 1000).ok).toBe(false);
    expect(validateTimestamp(-1, 1000).ok).toBe(false);
  });
});

describe("live post rules", () => {
  it("rejects lone surrogates with invalid_text", () => {
    expect(validatePostBody("hi \ud800")).toEqual({ ok: false, error: "invalid_text" });
  });
  it("keeps only the first 10 mentions", () => {
    const body = Array.from({ length: 12 }, (_, i) => `@user${i}`).join(" ");
    const m = extractMentions(body);
    expect(m).toHaveLength(10);
    expect(m[0]).toBe("user0");
    expect(m[9]).toBe("user9");
  });
});
