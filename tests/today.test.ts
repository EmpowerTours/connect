import { describe, expect, it } from "vitest";
import { dayPart, firstName, greeting, pickInsight, type InsightSignal } from "@/lib/today";
import { orgInitial, validateOpportunity } from "@/lib/opportunities";

describe("greeting", () => {
  it("maps hours to parts of the day", () => {
    expect(dayPart(5)).toBe("morning");
    expect(dayPart(11)).toBe("morning");
    expect(dayPart(12)).toBe("afternoon");
    expect(dayPart(18)).toBe("evening");
    expect(dayPart(2)).toBe("evening");
  });
  it("is bilingual", () => {
    expect(greeting(9, "en")).toBe("Morning");
    expect(greeting(9, "es")).toBe("Buenos días");
    expect(greeting(20, "es")).toBe("Buenas noches");
  });
  it("uses the first name", () => {
    expect(firstName("  Alex Rivera ")).toBe("Alex");
  });
});

describe("pickInsight", () => {
  const now = new Date("2026-10-15T12:00:00Z");
  const sig = (orgSlug: string, hoursAgo: number, title = `${orgSlug} news`): InsightSignal => ({
    orgSlug, orgName: orgSlug.toUpperCase(), title, sourceName: "Wire", url: null, publishedAt: new Date(now.getTime() - hoursAgo * 3600_000),
  });
  it("picks the org with the most recent signals and reports the latest one", () => {
    const r = pickInsight([sig("circle", 5, "old"), sig("circle", 1, "new"), sig("kraken", 2)], new Set(), now);
    expect(r?.orgSlug).toBe("circle");
    expect(r?.count).toBe(2);
    expect(r?.latest.title).toBe("new");
  });
  it("boosts orgs that are in your deals", () => {
    const r = pickInsight([sig("circle", 5), sig("circle", 1), sig("bitso", 2)], new Set(["bitso"]), now);
    expect(r?.orgSlug).toBe("bitso");
    expect(r?.inPipeline).toBe(true);
  });
  it("ignores signals outside the window and returns null when empty", () => {
    expect(pickInsight([sig("circle", 24 * 8)], new Set(), now)).toBeNull();
    expect(pickInsight([], new Set(), now)).toBeNull();
  });
});

describe("validateOpportunity", () => {
  const base = { kind: "ask", headline: "  Pesito is   raising ", body: "Seed round", region: "latam" };
  it("normalises a valid ask", () => {
    const r = validateOpportunity(base);
    expect(r.ok && r.value.headline).toBe("Pesito is raising");
  });
  it("rejects bad input", () => {
    expect(validateOpportunity({ ...base, kind: "cast" })).toEqual({ ok: false, error: "kind" });
    expect(validateOpportunity({ ...base, headline: "  " })).toEqual({ ok: false, error: "headline_empty" });
    expect(validateOpportunity({ ...base, headline: "x".repeat(91) })).toEqual({ ok: false, error: "headline_long" });
    expect(validateOpportunity({ ...base, body: "x".repeat(221) })).toEqual({ ok: false, error: "body_long" });
    expect(validateOpportunity({ ...base, region: "mars" })).toEqual({ ok: false, error: "region" });
  });
  it("allows an empty region", () => {
    expect(validateOpportunity({ ...base, region: "" }).ok).toBe(true);
  });
});

describe("orgInitial", () => {
  it("takes the first letter", () => {
    expect(orgInitial("banco Meridiano")).toBe("B");
    expect(orgInitial("¡Ñandú Pay")).toBe("Ñ");
    expect(orgInitial("")).toBe("?");
  });
});
