/**
 * The signed, portable social graph: EIP-712 shapes.
 *
 * Every follow/unfollow, organization membership (claim approved), admin
 * approval/revocation and accepted intro becomes one GraphUpdate message
 * signed by a Mera passkey wallet. Off-chain: no transaction, no gas, no
 * contract. Anyone holding the messages can verify them with any EIP-712
 * library (see scripts/verify-graph.ts) and rebuild the graph without us.
 *
 * Client-safe: no server imports. The browser builds the typed data from
 * these constants, never from the server's copy, so the server cannot get a
 * member to sign anything but a GraphUpdate with this exact statement.
 */
import { APP_DOMAIN, MONAD_CHAIN_ID } from "../mera/typed-data";
import { APP_FULL_NAME } from "../brand";

export { MONAD_CHAIN_ID };

/** Same domain as sign-in (name EmpowerToursConnect, version 1, chain 143); a different primary type. */
export const GRAPH_DOMAIN = APP_DOMAIN;

export const GRAPH_TYPES = {
  GraphUpdate: [
    { name: "author", type: "address" },
    { name: "action", type: "string" },
    { name: "subject", type: "address" },
    { name: "object", type: "address" },
    { name: "ref", type: "string" },
    { name: "seq", type: "uint64" },
    { name: "issuedAt", type: "uint64" },
    { name: "statement", type: "string" },
  ],
} as const;

export const GRAPH_STATEMENT = `Publish this update to my ${APP_FULL_NAME} graph. This does not authorise a transaction.`;

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

/**
 *   follow / unfollow         author follows subject (ref "user:<handle>", a hint only)
 *   member / unmember         author works at ref "org:<slug>" (subject, object zero)
 *   approve_member / revoke_member
 *                             author (an admin wallet) approves/revokes subject at ref "org:<slug>"
 *   intro                     author (the member who accepted) introduced subject (requester)
 *                             to object (target); ref "intro:<id>"
 */
export const GRAPH_ACTIONS = ["follow", "unfollow", "member", "unmember", "approve_member", "revoke_member", "intro"] as const;
export type GraphAction = (typeof GRAPH_ACTIONS)[number];
export const ADMIN_ACTIONS: readonly GraphAction[] = ["approve_member", "revoke_member"];

export function isGraphAction(v: string): v is GraphAction {
  return (GRAPH_ACTIONS as readonly string[]).includes(v);
}

/** JSON form of a GraphUpdate (numbers as decimal strings would also do; seq/issuedAt fit in JS numbers). */
export interface GraphMessage {
  author: string;
  action: GraphAction;
  subject: string;
  object: string;
  ref: string;
  seq: number;
  issuedAt: number;
}

export function graphTypedData(m: GraphMessage) {
  return {
    domain: GRAPH_DOMAIN,
    types: GRAPH_TYPES,
    primaryType: "GraphUpdate" as const,
    message: {
      author: m.author as `0x${string}`,
      action: m.action,
      subject: m.subject as `0x${string}`,
      object: m.object as `0x${string}`,
      ref: m.ref,
      seq: BigInt(m.seq),
      issuedAt: BigInt(m.issuedAt),
      statement: GRAPH_STATEMENT,
    },
  };
}

/** The identity of an operation, independent of seq/time. */
export function opKey(m: Pick<GraphMessage, "action" | "subject" | "object" | "ref">): string {
  return [m.action, m.subject.toLowerCase(), m.object.toLowerCase(), m.ref].join("|");
}
