import { describe, expect, it } from "vitest";
import { canTransition, competingChainMap, dueStatus, groupByStage, needsAttention, nextStage, prevStage, stageCounts } from "@/lib/pipeline";

const now = new Date(2026, 9, 15, 12);
const deal = (o: Partial<{ id: string; stage: string; due: Date | null; nextAction: string; chains: string[]; name: string; updatedAt: Date }>) => ({
  id: o.id ?? Math.random().toString(36),
  stage: o.stage ?? "awareness",
  nextActionDue: o.due ?? null,
  nextAction: o.nextAction ?? "Follow up",
  competingChains: JSON.stringify(o.chains ?? []),
  updatedAt: o.updatedAt ?? now,
  org: { name: o.name ?? "Org" },
});

describe("stage transitions", () => {
  it("allows one step forward, any step back", () => {
    expect(canTransition("awareness", "evaluation")).toBe(true);
    expect(canTransition("awareness", "pilot")).toBe(false);
    expect(canTransition("awareness", "committed")).toBe(false);
    expect(canTransition("committed", "awareness")).toBe(true);
    expect(canTransition("pilot", "evaluation")).toBe(true);
  });
  it("lost is reachable from anywhere and can be revived", () => {
    expect(canTransition("committed", "lost")).toBe(true);
    expect(canTransition("lost", "pilot")).toBe(true);
    expect(canTransition("lost", "lost")).toBe(false);
  });
  it("next/prev stage", () => {
    expect(nextStage("awareness")).toBe("evaluation");
    expect(nextStage("committed")).toBeNull();
    expect(prevStage("awareness")).toBeNull();
    expect(prevStage("pilot")).toBe("evaluation");
    expect(nextStage("lost")).toBeNull();
  });
});

describe("dueStatus", () => {
  it("classifies by calendar day", () => {
    expect(dueStatus(null, now)).toBe("none");
    expect(dueStatus(new Date(2026, 9, 14, 23), now)).toBe("overdue");
    expect(dueStatus(new Date(2026, 9, 15, 23), now)).toBe("today");
    expect(dueStatus(new Date(2026, 9, 20), now)).toBe("soon");
    expect(dueStatus(new Date(2026, 10, 20), now)).toBe("later");
  });
});

describe("grouping and views", () => {
  it("groups by stage, sorted by due date then name, unknown stage → awareness", () => {
    const g = groupByStage([
      deal({ id: "a", name: "Zeta", due: new Date(2026, 9, 20) }),
      deal({ id: "b", name: "Alpha" }),
      deal({ id: "c", name: "Beta", due: new Date(2026, 9, 16) }),
      deal({ id: "d", stage: "weird" }),
      deal({ id: "e", stage: "pilot" }),
    ]);
    expect(g.awareness.map((d) => d.id)).toEqual(["c", "a", "b", "d"]);
    expect(g.pilot).toHaveLength(1);
    expect(g.lost).toHaveLength(0);
  });

  it("needsAttention flags overdue, missing next action and stale deals only for active non-committed", () => {
    const list = [
      deal({ id: "overdue", due: new Date(2026, 9, 1) }),
      deal({ id: "noaction", nextAction: "  " }),
      deal({ id: "stale", updatedAt: new Date(2026, 8, 1) }),
      deal({ id: "fine", due: new Date(2026, 9, 20) }),
      deal({ id: "committed", stage: "committed", nextAction: "" }),
      deal({ id: "lost", stage: "lost", due: new Date(2026, 9, 1) }),
    ];
    expect(needsAttention(list, now).map((d) => d.id)).toEqual(["overdue", "noaction", "stale"]);
  });

  it("competingChainMap aggregates case-insensitively and ignores lost deals", () => {
    const map = competingChainMap([
      deal({ name: "Bank A", chains: ["Solana", "Avalanche"] }),
      deal({ name: "Bank B", chains: ["solana"] }),
      deal({ name: "Bank C", stage: "lost", chains: ["Solana"] }),
    ]);
    expect(map).toEqual([
      { chain: "Solana", orgs: ["Bank A", "Bank B"] },
      { chain: "Avalanche", orgs: ["Bank A"] },
    ]);
  });

  it("stageCounts", () => {
    expect(stageCounts([deal({}), deal({ stage: "pilot" }), deal({ stage: "pilot" })])).toMatchObject({ awareness: 1, pilot: 2, lost: 0 });
  });
});
