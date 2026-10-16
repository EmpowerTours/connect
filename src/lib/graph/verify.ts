/**
 * Verifying and replaying the signed graph. Pure (viem only): used by the
 * public API, the verify script anyone can run, and the tests.
 */
import { hashTypedData, isAddress, recoverTypedDataAddress, type Hex } from "viem";
import { ADMIN_ACTIONS, GRAPH_STATEMENT, ZERO_ADDRESS, graphTypedData, isGraphAction, type GraphMessage } from "./typed-data";

export interface SignedGraphEvent extends GraphMessage {
  signature: string;
  /** Optional on input; recomputed and compared when present. */
  digest?: string;
  statement?: string;
}

export type EventCheck =
  | { ok: true; digest: Hex }
  | { ok: false; digest: Hex | null; reason: "malformed" | "bad_statement" | "bad_signature" | "wrong_signer" | "digest_mismatch" };

const ADDR = (v: string) => isAddress(v, { strict: false });
const MAX_U64 = 2 ** 53 - 1; // JSON-safe

export function messageShapeOk(m: GraphMessage): boolean {
  return (
    isGraphAction(m.action) &&
    ADDR(m.author) &&
    m.author.toLowerCase() !== ZERO_ADDRESS &&
    ADDR(m.subject) &&
    ADDR(m.object) &&
    typeof m.ref === "string" &&
    m.ref.length <= 200 &&
    Number.isInteger(m.seq) &&
    m.seq >= 1 &&
    m.seq <= MAX_U64 &&
    Number.isInteger(m.issuedAt) &&
    m.issuedAt > 0 &&
    m.issuedAt <= MAX_U64
  );
}

export function graphDigest(m: GraphMessage): Hex {
  return hashTypedData(graphTypedData(m));
}

/** One event: the signature must recover to `author` over exactly this message and statement. */
export async function verifyGraphEvent(e: SignedGraphEvent): Promise<EventCheck> {
  if (!messageShapeOk(e) || typeof e.signature !== "string" || !/^0x[0-9a-fA-F]{130}$/.test(e.signature)) return { ok: false, digest: null, reason: "malformed" };
  if (e.statement !== undefined && e.statement !== GRAPH_STATEMENT) return { ok: false, digest: null, reason: "bad_statement" };
  const digest = graphDigest(e);
  if (e.digest && e.digest.toLowerCase() !== digest.toLowerCase()) return { ok: false, digest, reason: "digest_mismatch" };
  let signer: string;
  try {
    signer = await recoverTypedDataAddress({ ...graphTypedData(e), signature: e.signature as Hex });
  } catch {
    // Intentional: an unrecoverable signature is a verdict about the event, not a server fault.
    return { ok: false, digest, reason: "bad_signature" };
  }
  if (signer.toLowerCase() !== e.author.toLowerCase()) return { ok: false, digest, reason: "wrong_signer" };
  return { ok: true, digest };
}

export interface GraphState {
  /** author -> followed addresses */
  following: Map<string, Set<string>>;
  /** member -> org refs they claim (latest member/unmember) */
  claims: Map<string, Set<string>>;
  /** "member|org" -> latest admin decision */
  decisions: Map<string, { approved: boolean; admin: string; seq: number; issuedAt: number }>;
  intros: { introducer: string; requester: string; target: string; ref: string }[];
}

export interface LogReport {
  total: number;
  valid: number;
  invalid: { index: number; author: string; seq: number; reason: string }[];
  /** Per-author sequence problems: duplicates or gaps (a withheld update shows up as a gap). */
  sequenceIssues: { author: string; issue: "duplicate" | "gap"; seq: number }[];
  /** Admin actions signed by a wallet that is not in the admin list. */
  unauthorizedAdmin: { author: string; seq: number }[];
  state: GraphState;
}

const lc = (s: string) => s.toLowerCase();

/** Replays a log in per-author seq order. Invalid events are reported and ignored. */
export async function checkGraphLog(events: SignedGraphEvent[], admins: ReadonlySet<string>): Promise<LogReport> {
  const report: LogReport = {
    total: events.length,
    valid: 0,
    invalid: [],
    sequenceIssues: [],
    unauthorizedAdmin: [],
    state: { following: new Map(), claims: new Map(), decisions: new Map(), intros: [] },
  };
  const ok: SignedGraphEvent[] = [];
  for (const [index, e] of events.entries()) {
    const r = await verifyGraphEvent(e);
    if (!r.ok) report.invalid.push({ index, author: String(e.author), seq: Number(e.seq), reason: r.reason });
    else ok.push(e);
  }
  report.valid = ok.length;

  const byAuthor = new Map<string, SignedGraphEvent[]>();
  for (const e of ok) byAuthor.set(lc(e.author), [...(byAuthor.get(lc(e.author)) ?? []), e]);
  for (const [author, list] of byAuthor) {
    list.sort((a, b) => a.seq - b.seq);
    let expect = 1;
    for (const e of list) {
      if (e.seq < expect) report.sequenceIssues.push({ author, issue: "duplicate", seq: e.seq });
      else if (e.seq > expect) report.sequenceIssues.push({ author, issue: "gap", seq: expect });
      expect = Math.max(expect, e.seq + 1);
    }
  }

  // Admin decisions are ordered across admins by time, then seq.
  const ordered = [...ok].sort((a, b) => a.issuedAt - b.issuedAt || a.seq - b.seq);
  const s = report.state;
  for (const e of ordered) {
    const author = lc(e.author);
    const subject = lc(e.subject);
    if ((ADMIN_ACTIONS as readonly string[]).includes(e.action) && !admins.has(author)) {
      report.unauthorizedAdmin.push({ author, seq: e.seq });
      continue;
    }
    switch (e.action) {
      case "follow":
        if (!s.following.has(author)) s.following.set(author, new Set());
        s.following.get(author)!.add(subject);
        break;
      case "unfollow":
        s.following.get(author)?.delete(subject);
        break;
      case "member":
        if (!s.claims.has(author)) s.claims.set(author, new Set());
        s.claims.get(author)!.add(e.ref);
        break;
      case "unmember":
        s.claims.get(author)?.delete(e.ref);
        break;
      case "approve_member":
      case "revoke_member":
        s.decisions.set(`${subject}|${e.ref}`, { approved: e.action === "approve_member", admin: author, seq: e.seq, issuedAt: e.issuedAt });
        break;
      case "intro":
        s.intros.push({ introducer: author, requester: subject, target: lc(e.object), ref: e.ref });
        break;
    }
  }
  return report;
}

/** Memberships that are both claimed by the member and approved by an admin, per the signed log alone. */
export function verifiedMemberships(state: GraphState): { member: string; org: string; approvedBy: string }[] {
  const out: { member: string; org: string; approvedBy: string }[] = [];
  for (const [member, orgs] of state.claims) {
    for (const org of orgs) {
      const d = state.decisions.get(`${member}|${org}`);
      if (d?.approved) out.push({ member, org, approvedBy: d.admin });
    }
  }
  return out;
}

export function logIsClean(r: LogReport): boolean {
  return r.invalid.length === 0 && r.sequenceIssues.length === 0 && r.unauthorizedAdmin.length === 0;
}
