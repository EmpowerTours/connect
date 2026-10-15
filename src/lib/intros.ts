export const INTRO_STATUSES = ["draft", "pending", "accepted", "declined", "withdrawn"] as const;
export type IntroStatus = (typeof INTRO_STATUSES)[number];
export type IntroAction = "send" | "accept" | "decline" | "withdraw";

export interface IntroLike {
  status: string;
  requesterId: string;
  connectorId: string;
}

export type IntroResult = { ok: true; status: IntroStatus } | { ok: false; error: string };

/**
 * Intro state machine.
 *   draft   --send(requester)-->      pending
 *   pending --accept(connector)-->    accepted
 *   pending --decline(connector)-->   declined
 *   draft|pending --withdraw(requester)--> withdrawn
 */
export function applyIntroAction(intro: IntroLike, action: IntroAction, actorId: string): IntroResult {
  const s = intro.status;
  switch (action) {
    case "send":
      if (actorId !== intro.requesterId) return { ok: false, error: "Only the requester can send this intro request." };
      if (s !== "draft") return { ok: false, error: `Can't send an intro that is ${s}.` };
      return { ok: true, status: "pending" };
    case "accept":
    case "decline":
      if (actorId !== intro.connectorId) return { ok: false, error: "Only the connector can respond." };
      if (s !== "pending") return { ok: false, error: `Can't ${action} an intro that is ${s}.` };
      return { ok: true, status: action === "accept" ? "accepted" : "declined" };
    case "withdraw":
      if (actorId !== intro.requesterId) return { ok: false, error: "Only the requester can withdraw." };
      if (s !== "draft" && s !== "pending") return { ok: false, error: `Can't withdraw an intro that is ${s}.` };
      return { ok: true, status: "withdrawn" };
  }
}

export interface FollowEdge {
  followerId: string;
  followeeId: string;
}

/** Connections = mutual follows (LinkedIn-style two-way relationship on a Farcaster-style follow graph). */
export function connectionsOf(edges: FollowEdge[], userId: string): Set<string> {
  const out = new Set<string>();
  const inbound = new Set<string>();
  for (const e of edges) if (e.followeeId === userId) inbound.add(e.followerId);
  for (const e of edges) if (e.followerId === userId && inbound.has(e.followeeId)) out.add(e.followeeId);
  return out;
}

export function areConnected(edges: FollowEdge[], a: string, b: string): boolean {
  return connectionsOf(edges, a).has(b);
}

export function mutualConnections(edges: FollowEdge[], a: string, b: string): string[] {
  const ca = connectionsOf(edges, a);
  const cb = connectionsOf(edges, b);
  return [...ca].filter((id) => cb.has(id) && id !== a && id !== b).sort();
}

/** Validates an intro request; returns an error string or null. */
export function validateIntroRequest(
  req: { requesterId: string; connectorId: string; targetId: string },
  edges: FollowEdge[],
  open: { requesterId: string; targetId: string; status: string }[] = [],
): string | null {
  const { requesterId, connectorId, targetId } = req;
  if (requesterId === targetId) return "You can't request an intro to yourself.";
  if (connectorId === requesterId || connectorId === targetId) return "The connector must be a third person.";
  if (areConnected(edges, requesterId, targetId)) return "You're already connected — just message them.";
  if (!mutualConnections(edges, requesterId, targetId).includes(connectorId)) return "The connector must be connected to both of you.";
  if (open.some((i) => i.requesterId === requesterId && i.targetId === targetId && i.status === "pending"))
    return "You already have a pending intro request to this person.";
  return null;
}

export interface TrackRecord {
  dealsClosed: number;
  introsMade: number;
  helpfulPosts: number;
}

/** Proof-based reputation: closed deals > intros made > helpful posts. */
export function reputationScore(r: TrackRecord): number {
  return r.dealsClosed * 10 + r.introsMade * 5 + r.helpfulPosts * 2;
}

export function reputationTier(score: number): "new" | "active" | "trusted" | "connector" {
  if (score >= 60) return "connector";
  if (score >= 25) return "trusted";
  if (score >= 5) return "active";
  return "new";
}
