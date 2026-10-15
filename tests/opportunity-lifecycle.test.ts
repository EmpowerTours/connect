import { describe, expect, it } from "vitest";
import {
  DEFAULT_EXPIRY_DAYS,
  applyOpportunityAction,
  applyReportDecision,
  displayState,
  isLive,
  liveWhere,
  validateDirectIntro,
  validateOpportunity,
  validateReport,
} from "@/lib/opportunities";
import { applyIntroAction } from "@/lib/intros";

const NOW = new Date("2026-10-15T08:00:00Z");
const DAY = 86_400_000;
const later = (d: number) => new Date(NOW.getTime() + d * DAY);
const opp = (over: Partial<{ status: string; hidden: boolean; expiresAt: Date | null; authorId: string }> = {}) => ({
  status: "open",
  hidden: false,
  expiresAt: later(10),
  authorId: "author",
  ...over,
});

describe("opportunity create/edit validation", () => {
  const base = { kind: "ask", headline: "Custody partner for a LatAm fintech", body: "", region: "latam" };
  it("defaults to a 30 day expiry and no topic", () => {
    const r = validateOpportunity(base, NOW);
    expect(r.ok && r.value.expiresAt.getTime()).toBe(later(DEFAULT_EXPIRY_DAYS).getTime());
    expect(r.ok && r.value.topic).toBe("");
  });
  it("accepts a known topic and an allowed expiry", () => {
    const r = validateOpportunity({ ...base, topic: "custody", expiresInDays: "7" }, NOW);
    expect(r).toMatchObject({ ok: true, value: { topic: "custody", expiresAt: later(7) } });
  });
  it("rejects unknown topics and odd expiries", () => {
    expect(validateOpportunity({ ...base, topic: "memecoins" }, NOW)).toEqual({ ok: false, error: "topic" });
    expect(validateOpportunity({ ...base, expiresInDays: "3650" }, NOW)).toEqual({ ok: false, error: "expiry" });
    expect(validateOpportunity({ ...base, expiresInDays: "abc" }, NOW)).toEqual({ ok: false, error: "expiry" });
  });
});

describe("opportunity visibility", () => {
  it("is live only when open, not hidden and not expired", () => {
    expect(isLive(opp(), NOW)).toBe(true);
    expect(isLive(opp({ expiresAt: null }), NOW)).toBe(true);
    expect(isLive(opp({ expiresAt: later(-1) }), NOW)).toBe(false);
    expect(isLive(opp({ status: "filled" }), NOW)).toBe(false);
    expect(isLive(opp({ hidden: true }), NOW)).toBe(false);
  });
  it("labels the author's view", () => {
    expect(displayState(opp(), NOW)).toBe("live");
    expect(displayState(opp({ expiresAt: later(-1) }), NOW)).toBe("expired");
    expect(displayState(opp({ status: "closed" }), NOW)).toBe("closed");
    expect(displayState(opp({ status: "filled", hidden: true }), NOW)).toBe("hidden");
  });
  it("builds a matching database filter", () => {
    expect(liveWhere(NOW)).toEqual({ status: "open", hidden: false, OR: [{ expiresAt: null }, { expiresAt: { gt: NOW } }] });
  });
});

describe("opportunity lifecycle", () => {
  it("lets only the author edit, fill or close a live post", () => {
    expect(applyOpportunityAction(opp(), "edit", "author", NOW)).toEqual({ ok: true, status: "open" });
    expect(applyOpportunityAction(opp(), "fill", "author", NOW)).toEqual({ ok: true, status: "filled" });
    expect(applyOpportunityAction(opp(), "close", "author", NOW)).toEqual({ ok: true, status: "closed" });
    expect(applyOpportunityAction(opp(), "close", "someone", NOW)).toEqual({ ok: false, error: "not_owner" });
  });
  it("reopens filled, closed or expired posts but not live ones", () => {
    expect(applyOpportunityAction(opp({ status: "filled" }), "reopen", "author", NOW)).toEqual({ ok: true, status: "open" });
    expect(applyOpportunityAction(opp({ expiresAt: later(-2) }), "reopen", "author", NOW)).toEqual({ ok: true, status: "open" });
    expect(applyOpportunityAction(opp(), "reopen", "author", NOW)).toEqual({ ok: false, error: "state" });
    expect(applyOpportunityAction(opp({ status: "closed" }), "fill", "author", NOW)).toEqual({ ok: false, error: "state" });
    expect(applyOpportunityAction(opp({ status: "closed" }), "edit", "author", NOW)).toEqual({ ok: false, error: "state" });
  });
  it("freezes posts hidden by moderators", () => {
    for (const a of ["edit", "fill", "close", "reopen"] as const) {
      expect(applyOpportunityAction(opp({ hidden: true }), a, "author", NOW)).toEqual({ ok: false, error: "hidden" });
    }
  });
});

describe("direct intro requests on an opportunity", () => {
  const input = { requesterId: "me", opportunity: opp(), reason: "We run USDC payouts in Mexico", alreadyConnected: false, existing: [], now: NOW };
  it("accepts a reasoned request to a live post's author", () => {
    expect(validateDirectIntro(input)).toBeNull();
  });
  it("refuses self, closed/expired/hidden posts, existing connections and duplicates", () => {
    expect(validateDirectIntro({ ...input, requesterId: "author" })).toBe("self");
    expect(validateDirectIntro({ ...input, opportunity: opp({ status: "filled" }) })).toBe("not_live");
    expect(validateDirectIntro({ ...input, opportunity: opp({ expiresAt: later(-1) }) })).toBe("not_live");
    expect(validateDirectIntro({ ...input, opportunity: opp({ hidden: true }) })).toBe("not_live");
    expect(validateDirectIntro({ ...input, alreadyConnected: true })).toBe("connected");
    expect(validateDirectIntro({ ...input, existing: [{ status: "pending", opportunityId: "x" }] })).toBe("duplicate");
    expect(validateDirectIntro({ ...input, existing: [{ status: "declined", opportunityId: "x" }] })).toBeNull();
  });
  it("requires a short reason", () => {
    expect(validateDirectIntro({ ...input, reason: "   " })).toBe("reason_empty");
    expect(validateDirectIntro({ ...input, reason: "x".repeat(301) })).toBe("reason_long");
  });
  it("lets the author (connector = target) accept or decline, and the requester withdraw", () => {
    const intro = { status: "pending", requesterId: "me", connectorId: "author" };
    expect(applyIntroAction(intro, "accept", "author")).toEqual({ ok: true, status: "accepted" });
    expect(applyIntroAction(intro, "accept", "me").ok).toBe(false);
    expect(applyIntroAction(intro, "withdraw", "me")).toEqual({ ok: true, status: "withdrawn" });
  });
});

describe("reports and moderation", () => {
  it("validates reports", () => {
    expect(validateReport({ reporterId: "me", authorId: "author", reason: "spam", note: "  same post 5x " })).toEqual({ ok: true, value: { reason: "spam", note: "same post 5x" } });
    expect(validateReport({ reporterId: "author", authorId: "author", reason: "spam", note: "" })).toEqual({ ok: false, error: "self" });
    expect(validateReport({ reporterId: "me", authorId: "author", reason: "boring", note: "" })).toEqual({ ok: false, error: "reason" });
    expect(validateReport({ reporterId: "me", authorId: "author", reason: "other", note: "x".repeat(501) })).toEqual({ ok: false, error: "note_long" });
  });
  it("decides open reports once", () => {
    expect(applyReportDecision("open", "hide")).toEqual({ ok: true, status: "actioned" });
    expect(applyReportDecision("open", "dismiss")).toEqual({ ok: true, status: "dismissed" });
    expect(applyReportDecision("actioned", "dismiss")).toEqual({ ok: false });
    expect(applyReportDecision("dismissed", "hide")).toEqual({ ok: false });
  });
});
