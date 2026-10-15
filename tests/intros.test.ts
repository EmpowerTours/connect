import { describe, expect, it } from "vitest";
import { applyIntroAction, areConnected, connectionsOf, mutualConnections, reputationScore, reputationTier, validateIntroRequest } from "@/lib/intros";
import { MockScoutProvider } from "@/lib/scout/mock";

// me <-> val, val <-> tom, me <-> ana, ana <-> tom, me -> tom (one-way), sam -> me (one-way)
const both = (a: string, b: string) => [{ followerId: a, followeeId: b }, { followerId: b, followeeId: a }];
const edges = [...both("me", "val"), ...both("val", "tom"), ...both("me", "ana"), ...both("ana", "tom"), { followerId: "me", followeeId: "tom" }, { followerId: "sam", followeeId: "me" }];

describe("connections", () => {
  it("connections are mutual follows only", () => {
    expect([...connectionsOf(edges, "me")].sort()).toEqual(["ana", "val"]);
    expect(areConnected(edges, "me", "tom")).toBe(false);
    expect(areConnected(edges, "me", "sam")).toBe(false);
  });
  it("mutual connections", () => {
    expect(mutualConnections(edges, "me", "tom")).toEqual(["ana", "val"]);
    expect(mutualConnections(edges, "me", "sam")).toEqual([]);
  });
});

describe("validateIntroRequest", () => {
  const req = { requesterId: "me", connectorId: "val", targetId: "tom" };
  it("accepts a valid request", () => {
    expect(validateIntroRequest(req, edges)).toBeNull();
  });
  it("rejects self, bad connector, existing connection, duplicates", () => {
    expect(validateIntroRequest({ ...req, targetId: "me" }, edges)).toMatch(/yourself/);
    expect(validateIntroRequest({ ...req, connectorId: "tom" }, edges)).toMatch(/third person/);
    expect(validateIntroRequest({ ...req, connectorId: "sam" }, edges)).toMatch(/connected to both/);
    expect(validateIntroRequest({ requesterId: "me", connectorId: "tom", targetId: "val" }, edges)).toMatch(/already connected/);
    expect(validateIntroRequest(req, edges, [{ requesterId: "me", targetId: "tom", status: "pending" }])).toMatch(/pending/);
    expect(validateIntroRequest(req, edges, [{ requesterId: "me", targetId: "tom", status: "declined" }])).toBeNull();
  });
});

describe("intro state machine", () => {
  const base = { requesterId: "me", connectorId: "val" };
  it("happy path draft → pending → accepted", () => {
    expect(applyIntroAction({ ...base, status: "draft" }, "send", "me")).toEqual({ ok: true, status: "pending" });
    expect(applyIntroAction({ ...base, status: "pending" }, "accept", "val")).toEqual({ ok: true, status: "accepted" });
    expect(applyIntroAction({ ...base, status: "pending" }, "decline", "val")).toEqual({ ok: true, status: "declined" });
  });
  it("enforces actors", () => {
    expect(applyIntroAction({ ...base, status: "draft" }, "send", "val").ok).toBe(false);
    expect(applyIntroAction({ ...base, status: "pending" }, "accept", "me").ok).toBe(false);
    expect(applyIntroAction({ ...base, status: "pending" }, "withdraw", "val").ok).toBe(false);
  });
  it("enforces states", () => {
    expect(applyIntroAction({ ...base, status: "draft" }, "accept", "val").ok).toBe(false);
    expect(applyIntroAction({ ...base, status: "accepted" }, "decline", "val").ok).toBe(false);
    expect(applyIntroAction({ ...base, status: "accepted" }, "withdraw", "me").ok).toBe(false);
    expect(applyIntroAction({ ...base, status: "pending" }, "send", "me").ok).toBe(false);
    expect(applyIntroAction({ ...base, status: "pending" }, "withdraw", "me")).toEqual({ ok: true, status: "withdrawn" });
  });
});

describe("reputation", () => {
  it("weights deals > intros > helpful posts", () => {
    expect(reputationScore({ dealsClosed: 1, introsMade: 2, helpfulPosts: 3 })).toBe(26);
    expect(reputationTier(0)).toBe("new");
    expect(reputationTier(5)).toBe("active");
    expect(reputationTier(26)).toBe("trusted");
    expect(reputationTier(60)).toBe("connector");
  });
});

describe("AI intro draft (mock provider)", () => {
  const input = {
    locale: "en" as const,
    requester: { name: "Demo BD Lead", headline: "BD", orgName: "EmpowerTours", voice: "" },
    connector: { name: "Valeria Ortiz" },
    target: { name: "Tomás Reyes", headline: "Head of Partnerships", orgName: "Quetzal Rails" },
    reason: "Explore a stablecoin settlement pilot",
    sharedTopics: ["Bitso", "stablecoins"],
  };
  it("addresses the connector, names the target and reason, signs as requester", async () => {
    const r = await new MockScoutProvider().draftIntro(input);
    expect(r.provider).toBe("mock");
    expect(r.message).toMatch(/^Hi Valeria,/);
    expect(r.message).toContain("introducing me to Tomás (Head of Partnerships at Quetzal Rails)");
    expect(r.message).toContain("Here's why I'm asking: explore a stablecoin settlement pilot");
    expect(r.message).not.toContain("..");
    expect(r.message).toContain("Bitso, stablecoins");
    expect(r.message.trim().endsWith("Demo BD Lead")).toBe(true);
  });
  it("Spanish and short voice", async () => {
    const r = await new MockScoutProvider().draftIntro({ ...input, locale: "es", requester: { ...input.requester, voice: "breve" } });
    expect(r.message).toMatch(/^Hola Valeria,/);
    expect(r.message).not.toContain("Ambos estamos siguiendo");
    expect(r.message).toContain("Te cuento el motivo:");
  });
  it("strips a trailing period from the reason", async () => {
    const r = await new MockScoutProvider().draftIntro({ ...input, reason: "Exploring a USDC pilot." });
    expect(r.message).toContain("exploring a USDC pilot.");
    expect(r.message).not.toContain("pilot..");
  });
});
