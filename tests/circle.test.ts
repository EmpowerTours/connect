import { describe, expect, it } from "vitest";
import { buildCircle, orbitPositions, outerAngles, warmPath } from "@/lib/circle";
import type { FollowEdge } from "@/lib/intros";

const both = (a: string, b: string): FollowEdge[] => [
  { followerId: a, followeeId: b },
  { followerId: b, followeeId: a },
];
// me — ana — tom ; me — bea — tom ; bea — zed ; me → kim (one-way, not a connection)
const edges: FollowEdge[] = [
  ...both("me", "ana"),
  ...both("me", "bea"),
  ...both("ana", "tom"),
  ...both("bea", "tom"),
  ...both("bea", "zed"),
  ...both("bea", "ana"),
  { followerId: "me", followeeId: "kim" },
];

describe("buildCircle", () => {
  it("puts connections on ring 1 and people one intro away on ring 2", () => {
    const c = buildCircle(edges, "me");
    expect(c.filter((n) => n.ring === 1).map((n) => n.id)).toEqual(["ana", "bea"]);
    const ring2 = c.filter((n) => n.ring === 2);
    expect(ring2.map((n) => n.id)).toEqual(["tom", "zed"]); // tom has 2 connectors, so first
    expect(ring2[0].via).toEqual(["ana", "bea"]);
    expect(ring2[1].via).toEqual(["bea"]);
  });
  it("ignores one-way follows and never includes the viewer", () => {
    const ids = buildCircle(edges, "me").map((n) => n.id);
    expect(ids).not.toContain("kim");
    expect(ids).not.toContain("me");
  });
  it("respects ring limits", () => {
    expect(buildCircle(edges, "me", { ring1: 1, ring2: 1 }).map((n) => n.id)).toEqual(["ana", "tom"]);
  });
  it("is empty for someone with no connections", () => {
    expect(buildCircle(edges, "kim")).toEqual([]);
  });
});

describe("warmPath", () => {
  it("is direct for a connection", () => {
    expect(warmPath(edges, "me", "ana")).toEqual(["me", "ana"]);
  });
  it("goes through the best-connected mutual connection", () => {
    // ana and bea both know tom; tie → stable by id
    expect(warmPath(edges, "me", "tom")).toEqual(["me", "ana", "tom"]);
    // give bea one more shared connection with tom, so bea wins
    expect(warmPath([...edges, ...both("bea", "x"), ...both("tom", "x")], "me", "tom")).toEqual(["me", "bea", "tom"]);
    expect(warmPath(edges, "me", "zed")).toEqual(["me", "bea", "zed"]);
  });
  it("returns null when more than one intro away or for yourself", () => {
    expect(warmPath(edges, "me", "kim")).toBeNull();
    expect(warmPath(edges, "me", "me")).toBeNull();
    expect(warmPath([...edges, ...both("zed", "far")], "me", "far")).toBeNull();
  });
});

describe("orbitPositions", () => {
  it("starts at the top and spaces nodes evenly", () => {
    const p = orbitPositions(4, 40);
    expect(p[0].x).toBeCloseTo(50);
    expect(p[0].y).toBeCloseTo(10);
    expect(p[1].x).toBeCloseTo(90);
    expect(p[2].y).toBeCloseTo(90);
  });
});

describe("outerAngles", () => {
  it("places outer nodes in the gaps next to their connector", () => {
    // inner nodes at 0, 90, 180, 270
    expect(outerAngles(4, [0, 1, 3])).toEqual([45, 135, 225]);
    // two nodes via the same connector take both neighbouring gaps
    const a = outerAngles(4, [2, 2]);
    expect(a.sort((x, y) => x - y)).toEqual([135, 225]);
  });
  it("never lands on an inner node's angle", () => {
    const a = outerAngles(3, [0, 1, 2, 0, 1]);
    for (const x of a) expect([0, 120, 240]).not.toContain(x);
    expect(new Set(a).size).toBe(5);
  });
  it("falls back to even spacing with no inner ring", () => {
    expect(outerAngles(0, [-1, -1])).toEqual([90, 270]);
  });
});
