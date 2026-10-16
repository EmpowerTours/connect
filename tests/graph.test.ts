import { describe, expect, it } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { planGraphOps, prepareMessages, validateBatch, type GraphDbState } from "@/lib/graph/plan";
import { GRAPH_DOMAIN, GRAPH_STATEMENT, ZERO_ADDRESS, graphTypedData, opKey, type GraphMessage } from "@/lib/graph/typed-data";
import { checkGraphLog, graphDigest, logIsClean, verifiedMemberships, verifyGraphEvent, type SignedGraphEvent } from "@/lib/graph/verify";

// Throwaway test keys. They sign off-chain EIP-712 messages only.
const ana = privateKeyToAccount(`0x${"11".repeat(32)}`);
const bea = privateKeyToAccount(`0x${"22".repeat(32)}`);
const admin = privateKeyToAccount(`0x${"33".repeat(32)}`);
const A = ana.address.toLowerCase();
const B = bea.address.toLowerCase();
const ADM = admin.address.toLowerCase();
const T0 = 1_792_000_000;

type Acct = typeof ana;
async function sign(acct: Acct, m: Omit<GraphMessage, "author">): Promise<SignedGraphEvent> {
  const msg = { ...m, author: acct.address.toLowerCase() };
  return { ...msg, signature: await acct.signTypedData(graphTypedData(msg)), statement: GRAPH_STATEMENT };
}
const follow = (subject: string, seq: number) => ({ action: "follow" as const, subject, object: ZERO_ADDRESS, ref: "user:x", seq, issuedAt: T0 + seq });

describe("graph typed data", () => {
  it("uses the Connect domain on Monad and a pinned, no-transaction statement", () => {
    expect(GRAPH_DOMAIN).toEqual({ name: "EmpowerToursConnect", version: "1", chainId: 143 });
    const td = graphTypedData({ author: A, action: "follow", subject: B, object: ZERO_ADDRESS, ref: "", seq: 1, issuedAt: T0 });
    expect(td.primaryType).toBe("GraphUpdate");
    expect(td.message.statement).toBe(GRAPH_STATEMENT);
    expect(GRAPH_STATEMENT).toMatch(/does not authorise a transaction/);
  });
});

describe("verifyGraphEvent", () => {
  it("accepts a real signature and returns the EIP-712 digest", async () => {
    const e = await sign(ana, follow(B, 1));
    const r = await verifyGraphEvent(e);
    expect(r).toEqual({ ok: true, digest: graphDigest(e) });
  });
  it("rejects tampering, a wrong signer, a wrong statement, a wrong digest and junk", async () => {
    const e = await sign(ana, follow(B, 1));
    expect(await verifyGraphEvent({ ...e, subject: ADM })).toMatchObject({ ok: false, reason: "wrong_signer" });
    expect(await verifyGraphEvent({ ...e, author: B })).toMatchObject({ ok: false, reason: "wrong_signer" });
    expect(await verifyGraphEvent({ ...e, statement: "Send 1 MON" })).toMatchObject({ ok: false, reason: "bad_statement" });
    expect(await verifyGraphEvent({ ...e, digest: `0x${"00".repeat(32)}` })).toMatchObject({ ok: false, reason: "digest_mismatch" });
    expect(await verifyGraphEvent({ ...e, signature: "0x1234" })).toMatchObject({ ok: false, reason: "malformed" });
    expect(await verifyGraphEvent({ ...e, action: "transfer" as never })).toMatchObject({ ok: false, reason: "malformed" });
    expect(await verifyGraphEvent({ ...e, seq: 0 })).toMatchObject({ ok: false, reason: "malformed" });
  });
  it("a sign-in style signature cannot pass as a graph update", async () => {
    const e = await sign(ana, follow(B, 1));
    const session = await ana.signTypedData({
      domain: GRAPH_DOMAIN,
      types: { Session: [{ name: "wallet", type: "address" }, { name: "statement", type: "string" }, { name: "clientTs", type: "uint256" }, { name: "nonce", type: "string" }] },
      primaryType: "Session",
      message: { wallet: ana.address, statement: "x", clientTs: BigInt(T0), nonce: "n".repeat(16) },
    });
    expect(await verifyGraphEvent({ ...e, signature: session })).toMatchObject({ ok: false, reason: "wrong_signer" });
  });
});

describe("checkGraphLog (replay)", () => {
  it("replays follows, memberships with admin approval, revocations and intros", async () => {
    const log = [
      await sign(ana, follow(B, 1)),
      await sign(bea, { action: "member", subject: ZERO_ADDRESS, object: ZERO_ADDRESS, ref: "org:bitso", seq: 1, issuedAt: T0 + 1 }),
      await sign(admin, { action: "approve_member", subject: B, object: ZERO_ADDRESS, ref: "org:bitso", seq: 1, issuedAt: T0 + 2 }),
      await sign(ana, { action: "intro", subject: B, object: ADM, ref: "intro:i1", seq: 2, issuedAt: T0 + 3 }),
      await sign(ana, { action: "unfollow", subject: B, object: ZERO_ADDRESS, ref: "", seq: 3, issuedAt: T0 + 4 }),
    ];
    const r = await checkGraphLog(log, new Set([ADM]));
    expect(logIsClean(r)).toBe(true);
    expect([...(r.state.following.get(A) ?? [])]).toEqual([]);
    expect(verifiedMemberships(r.state)).toEqual([{ member: B, org: "org:bitso", approvedBy: ADM }]);
    expect(r.state.intros).toEqual([{ introducer: A, requester: B, target: ADM, ref: "intro:i1" }]);

    const revoked = await checkGraphLog(
      [...log, await sign(admin, { action: "revoke_member", subject: B, object: ZERO_ADDRESS, ref: "org:bitso", seq: 2, issuedAt: T0 + 9 })],
      new Set([ADM]),
    );
    expect(verifiedMemberships(revoked.state)).toEqual([]);
  });

  it("a member's claim alone is not a verified membership; neither is an approval alone", async () => {
    const claimOnly = await checkGraphLog([await sign(bea, { action: "member", subject: ZERO_ADDRESS, object: ZERO_ADDRESS, ref: "org:bitso", seq: 1, issuedAt: T0 })], new Set([ADM]));
    expect(verifiedMemberships(claimOnly.state)).toEqual([]);
    const approvalOnly = await checkGraphLog([await sign(admin, { action: "approve_member", subject: B, object: ZERO_ADDRESS, ref: "org:bitso", seq: 1, issuedAt: T0 })], new Set([ADM]));
    expect(verifiedMemberships(approvalOnly.state)).toEqual([]);
  });

  it("ignores admin actions from non-admin wallets and reports them", async () => {
    const forged = await sign(ana, { action: "approve_member", subject: A, object: ZERO_ADDRESS, ref: "org:bitso", seq: 1, issuedAt: T0 });
    const r = await checkGraphLog([forged], new Set([ADM]));
    expect(r.unauthorizedAdmin).toEqual([{ author: A, seq: 1 }]);
    expect(r.state.decisions.size).toBe(0);
    expect(logIsClean(r)).toBe(false);
  });

  it("flags duplicate and missing seqs (a withheld update shows up as a gap)", async () => {
    const gap = await checkGraphLog([await sign(ana, follow(B, 1)), await sign(ana, follow(ADM, 3))], new Set());
    expect(gap.sequenceIssues).toEqual([{ author: A, issue: "gap", seq: 2 }]);
    const dup = await checkGraphLog([await sign(ana, follow(B, 1)), await sign(ana, follow(ADM, 1))], new Set());
    expect(dup.sequenceIssues).toEqual([{ author: A, issue: "duplicate", seq: 1 }]);
  });

  it("reports and skips invalid events", async () => {
    const good = await sign(ana, follow(B, 1));
    const r = await checkGraphLog([good, { ...good, seq: 2 }], new Set());
    expect(r.valid).toBe(1);
    expect(r.invalid).toEqual([{ index: 1, author: A, seq: 2, reason: "wrong_signer" }]);
  });
});

describe("planGraphOps (what is left to sign)", () => {
  const db = (over: Partial<GraphDbState> = {}): GraphDbState => ({ wallet: A, follows: [], memberships: [], intros: [], ...over });

  it("everything is pending on an empty log, in a stable order", async () => {
    const empty = (await checkGraphLog([], new Set())).state;
    const ops = planGraphOps(db({ follows: [{ wallet: B, handle: "bea" }, { wallet: A, handle: "me" }], memberships: ["org:bitso"], intros: [{ id: "i1", requester: B, target: ADM }] }), empty);
    expect(ops.map((o) => `${o.action}:${o.ref}`)).toEqual(["member:org:bitso", "follow:user:bea", "intro:intro:i1"]); // self-follow dropped
  });

  it("signed follows are not re-proposed; follows removed since are proposed as unfollows", async () => {
    const state = (await checkGraphLog([await sign(ana, follow(B, 1)), await sign(ana, follow(ADM, 2))], new Set())).state;
    const ops = planGraphOps(db({ follows: [{ wallet: B, handle: "bea" }] }), state);
    expect(ops).toEqual([{ action: "unfollow", subject: ADM, object: ZERO_ADDRESS, ref: "" }]);
  });

  it("admins get approvals to sign until one is on the log, and revocations after", async () => {
    const empty = (await checkGraphLog([], new Set([ADM]))).state;
    const asAdmin = (approved: boolean): GraphDbState => ({ wallet: ADM, follows: [], memberships: [], intros: [], adminDecisions: [{ member: B, orgRef: "org:bitso", approved }] });
    expect(planGraphOps(asAdmin(true), empty).map((o) => o.action)).toEqual(["approve_member"]);
    expect(planGraphOps(asAdmin(false), empty)).toEqual([]); // nothing to revoke yet
    const approved = (await checkGraphLog([await sign(admin, { action: "approve_member", subject: B, object: ZERO_ADDRESS, ref: "org:bitso", seq: 1, issuedAt: T0 })], new Set([ADM]))).state;
    expect(planGraphOps(asAdmin(true), approved)).toEqual([]);
    expect(planGraphOps(asAdmin(false), approved).map((o) => o.action)).toEqual(["revoke_member"]);
  });

  it("prepares consecutive seqs after the last signed one", () => {
    const msgs = prepareMessages([{ action: "follow", subject: B, object: ZERO_ADDRESS, ref: "user:bea" }, { action: "member", subject: ZERO_ADDRESS, object: ZERO_ADDRESS, ref: "org:bitso" }], A.toUpperCase().replace("0X", "0x"), 4, T0);
    expect(msgs.map((m) => [m.author, m.seq, m.issuedAt])).toEqual([[A, 5, T0], [A, 6, T0]]);
  });
});

describe("validateBatch (server side of signing)", () => {
  const pending = [
    { action: "follow" as const, subject: B, object: ZERO_ADDRESS, ref: "user:bea" },
    { action: "member" as const, subject: ZERO_ADDRESS, object: ZERO_ADDRESS, ref: "org:bitso" },
  ];
  const msgs = prepareMessages(pending, A, 2, T0);
  const ctx = { wallet: A, pending, lastSeq: 2, now: T0 + 5 };

  it("accepts exactly the pending ops with the next seqs", () => {
    expect(validateBatch(msgs, ctx)).toEqual({ ok: true });
    expect(validateBatch(msgs.slice(0, 1), ctx)).toEqual({ ok: true });
  });
  it("rejects empty, foreign, unknown, repeated, out-of-order and stale messages", () => {
    expect(validateBatch([], ctx)).toMatchObject({ error: "empty" });
    expect(validateBatch([{ ...msgs[0], author: B }], ctx)).toMatchObject({ error: "wrong_author" });
    expect(validateBatch([{ ...msgs[0], subject: ADM }], ctx)).toMatchObject({ error: "not_pending" });
    expect(validateBatch([msgs[0], { ...msgs[0], seq: 4 }], ctx)).toMatchObject({ error: "not_pending", index: 1 });
    expect(validateBatch([msgs[1]], ctx)).toMatchObject({ error: "bad_seq" });
    expect(validateBatch(msgs, { ...ctx, now: T0 + 3600 })).toMatchObject({ error: "stale" });
  });
  it("op identity ignores seq and time", () => {
    const later: GraphMessage = { ...msgs[0], seq: 99, issuedAt: 1 };
    expect(opKey(msgs[0])).toBe(opKey(later));
  });
});
