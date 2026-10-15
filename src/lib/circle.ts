import { connectionsOf, type FollowEdge } from "./intros";

/**
 * Warm network ("Circle"): 1st ring = your connections (mutual follows),
 * 2nd ring = people one intro away (connected to someone in your 1st ring).
 */
export interface CircleNode {
  id: string;
  ring: 1 | 2;
  /** For ring 2: the 1st-ring connections who can introduce you, best first. */
  via: string[];
}

export function buildCircle(edges: FollowEdge[], viewerId: string, limits = { ring1: 8, ring2: 10 }): CircleNode[] {
  const first = connectionsOf(edges, viewerId);
  const ring1: CircleNode[] = [...first].sort().map((id) => ({ id, ring: 1, via: [] }));
  const viaMap = new Map<string, string[]>();
  for (const c of [...first].sort()) {
    for (const id of connectionsOf(edges, c)) {
      if (id === viewerId || first.has(id)) continue;
      viaMap.set(id, [...(viaMap.get(id) ?? []), c]);
    }
  }
  const ring2: CircleNode[] = [...viaMap.entries()]
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
    .map(([id, via]) => ({ id, ring: 2, via }));
  return [...ring1.slice(0, limits.ring1), ...ring2.slice(0, limits.ring2)];
}

/**
 * Shortest warm path from viewer to target, at most one intro away:
 * [viewer, target] when connected, [viewer, connector, target] when one intro away, else null.
 * Ties pick the connector with the most shared connections with the target, then by id for stability.
 */
export function warmPath(edges: FollowEdge[], viewerId: string, targetId: string): string[] | null {
  if (viewerId === targetId) return null;
  const mine = connectionsOf(edges, viewerId);
  if (mine.has(targetId)) return [viewerId, targetId];
  const theirs = connectionsOf(edges, targetId);
  const connectors = [...mine].filter((c) => theirs.has(c));
  if (connectors.length === 0) return null;
  const score = (c: string) => [...connectionsOf(edges, c)].filter((x) => theirs.has(x)).length;
  connectors.sort((a, b) => score(b) - score(a) || a.localeCompare(b));
  return [viewerId, connectors[0], targetId];
}

/** Evenly spaced positions (percent of the orbit box) for nodes on a ring, starting at the top. */
export function orbitPositions(count: number, radiusPct: number, offsetDeg = 0): { x: number; y: number }[] {
  return Array.from({ length: count }, (_, i) => {
    const a = ((offsetDeg + (360 / Math.max(count, 1)) * i - 90) * Math.PI) / 180;
    return { x: 50 + radiusPct * Math.cos(a), y: 50 + radiusPct * Math.sin(a) };
  });
}

/**
 * Angles (degrees, 0 = top, clockwise) for the outer ring. Outer nodes sit in the gaps between inner
 * nodes (so labels don't collide), each as close as possible to its connector on the inner ring.
 * `viaIndex[i]` is the inner-ring index of node i's first connector (or -1).
 */
export function outerAngles(innerCount: number, viaIndex: number[]): number[] {
  const n = viaIndex.length;
  if (n === 0) return [];
  if (innerCount === 0 || n > innerCount * 2) return viaIndex.map((_, i) => (360 / n) * i + 180 / n);
  const step = 360 / innerCount;
  // Gap slots between inner nodes; when there are more outer nodes than gaps, split each gap in two.
  const perGap = n > innerCount ? 2 : 1;
  const slots: number[] = [];
  for (let g = 0; g < innerCount; g++)
    for (let k = 0; k < perGap; k++) slots.push(g * step + (step * (k + 1)) / (perGap + 1));
  const taken = new Set<number>();
  const dist = (a: number, b: number) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));
  return viaIndex.map((v) => {
    const want = v >= 0 ? v * step : 0;
    let best = -1;
    for (let s = 0; s < slots.length; s++) if (!taken.has(s) && (best < 0 || dist(slots[s], want) < dist(slots[best], want))) best = s;
    taken.add(best);
    return slots[best];
  });
}

export function anglePosition(deg: number, radiusPct: number): { x: number; y: number } {
  const a = ((deg - 90) * Math.PI) / 180;
  return { x: 50 + radiusPct * Math.cos(a), y: 50 + radiusPct * Math.sin(a) };
}
