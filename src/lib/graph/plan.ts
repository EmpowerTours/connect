/**
 * What a member still has to sign: the difference between the app's current
 * state (database) and what their wallet has already signed. Pure.
 *
 * Diffing instead of hooking every write means follows made anywhere (profile,
 * importer, accepted direct intro) are covered, an unfollow before signing
 * simply cancels the pending follow, and a member who links a wallet later can
 * publish their whole graph in one passkey prompt.
 */
import { ZERO_ADDRESS, opKey, type GraphAction, type GraphMessage } from "./typed-data";
import type { GraphState } from "./verify";

export interface GraphDbState {
  wallet: string;
  follows: { wallet: string; handle: string }[];
  /** Org refs ("org:<slug>") of the member's approved claims. */
  memberships: string[];
  /** Accepted intros this member made (they were the connector, or the author for direct requests). */
  intros: { id: string; requester: string; target: string }[];
  /** Only for admin wallets: every claim decision that should be on the log. */
  adminDecisions?: { member: string; orgRef: string; approved: boolean }[];
}

export interface PendingOp {
  action: GraphAction;
  subject: string;
  object: string;
  ref: string;
}

const lc = (s: string) => s.toLowerCase();

export function planGraphOps(db: GraphDbState, signed: GraphState): PendingOp[] {
  const me = lc(db.wallet);
  const ops: PendingOp[] = [];

  const claimed = signed.claims.get(me) ?? new Set<string>();
  const wantOrgs = new Set(db.memberships);
  for (const ref of [...wantOrgs].sort()) if (!claimed.has(ref)) ops.push({ action: "member", subject: ZERO_ADDRESS, object: ZERO_ADDRESS, ref });
  for (const ref of [...claimed].sort()) if (!wantOrgs.has(ref)) ops.push({ action: "unmember", subject: ZERO_ADDRESS, object: ZERO_ADDRESS, ref });

  const signedFollows = signed.following.get(me) ?? new Set<string>();
  const want = new Map(db.follows.filter((f) => lc(f.wallet) !== me).map((f) => [lc(f.wallet), f.handle]));
  for (const [w, handle] of want) if (!signedFollows.has(w)) ops.push({ action: "follow", subject: w, object: ZERO_ADDRESS, ref: `user:${handle}` });
  for (const w of [...signedFollows].sort()) if (!want.has(w)) ops.push({ action: "unfollow", subject: w, object: ZERO_ADDRESS, ref: "" });

  const signedIntros = new Set(signed.intros.filter((i) => i.introducer === me).map((i) => i.ref));
  for (const i of db.intros) {
    const ref = `intro:${i.id}`;
    if (!signedIntros.has(ref)) ops.push({ action: "intro", subject: lc(i.requester), object: lc(i.target), ref });
  }

  for (const d of db.adminDecisions ?? []) {
    const current = signed.decisions.get(`${lc(d.member)}|${d.orgRef}`);
    if (d.approved && !current?.approved) ops.push({ action: "approve_member", subject: lc(d.member), object: ZERO_ADDRESS, ref: d.orgRef });
    if (!d.approved && current?.approved) ops.push({ action: "revoke_member", subject: lc(d.member), object: ZERO_ADDRESS, ref: d.orgRef });
  }

  // One op per identity (e.g. two claims for the same org collapse).
  const seen = new Set<string>();
  return ops.filter((o) => (seen.has(opKey(o)) ? false : (seen.add(opKey(o)), true)));
}

/** Turn ops into messages with consecutive seqs after the author's last signed one. */
export function prepareMessages(ops: PendingOp[], author: string, lastSeq: number, issuedAt: number): GraphMessage[] {
  return ops.map((o, i) => ({ author: lc(author), action: o.action, subject: o.subject, object: o.object, ref: o.ref, seq: lastSeq + i + 1, issuedAt }));
}

/** Accepted clock skew for issuedAt on submit, seconds. */
export const ISSUED_AT_SKEW = 600;
export const MAX_BATCH = 200;

export type SubmitError = "empty" | "too_many" | "wrong_author" | "not_pending" | "bad_seq" | "stale" | "bad_signature";

/**
 * Check a submitted batch against what is pending right now: every message is
 * by this wallet, is a currently pending op, has the next consecutive seq and
 * a fresh issuedAt. Signatures are checked separately.
 */
export function validateBatch(
  messages: GraphMessage[],
  ctx: { wallet: string; pending: PendingOp[]; lastSeq: number; now: number },
): { ok: true } | { ok: false; error: SubmitError; index?: number } {
  if (!messages.length) return { ok: false, error: "empty" };
  if (messages.length > MAX_BATCH) return { ok: false, error: "too_many" };
  const pending = new Set(ctx.pending.map(opKey));
  const used = new Set<string>();
  for (const [index, m] of messages.entries()) {
    if (lc(m.author) !== lc(ctx.wallet)) return { ok: false, error: "wrong_author", index };
    const k = opKey(m);
    if (!pending.has(k) || used.has(k)) return { ok: false, error: "not_pending", index };
    used.add(k);
    if (m.seq !== ctx.lastSeq + index + 1) return { ok: false, error: "bad_seq", index };
    if (Math.abs(ctx.now - m.issuedAt) > ISSUED_AT_SKEW) return { ok: false, error: "stale", index };
  }
  return { ok: true };
}
