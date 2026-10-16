import "server-only";
import type { Prisma, User } from "@prisma/client";
import { adminWallets } from "../admin";
import { prisma } from "../db";
import { logger } from "../log";
import { ADMIN_ACTIONS, GRAPH_STATEMENT, ZERO_ADDRESS, isGraphAction, type GraphMessage } from "./typed-data";
import { checkGraphLog, verifyGraphEvent, type SignedGraphEvent } from "./verify";
import { planGraphOps, prepareMessages, validateBatch, type GraphDbState, type PendingOp, type SubmitError } from "./plan";

type Row = Prisma.GraphEventGetPayload<object>;

export function rowToEvent(r: Row): SignedGraphEvent & { id: number; createdAt: Date } {
  return {
    id: r.id,
    author: r.author,
    action: isGraphAction(r.action) ? r.action : "follow",
    subject: r.subject,
    object: r.object,
    ref: r.ref,
    seq: r.seq,
    issuedAt: r.issuedAt,
    statement: r.statement,
    signature: r.signature,
    digest: r.digest,
    createdAt: r.createdAt,
  };
}

/** The member's own events plus every admin decision (needed to know which approvals are already signed). */
async function relevantEvents(wallet: string) {
  const rows = await prisma.graphEvent.findMany({
    where: { OR: [{ author: wallet }, { action: { in: [...ADMIN_ACTIONS] } }] },
    orderBy: { id: "asc" },
  });
  return rows.map(rowToEvent);
}

async function lastSeqOf(wallet: string): Promise<number> {
  const last = await prisma.graphEvent.findFirst({ where: { author: wallet }, orderBy: { seq: "desc" }, select: { seq: true } });
  return last?.seq ?? 0;
}

export function graphWallet(user: Pick<User, "walletAddress" | "walletVerified">): string | null {
  return user.walletVerified && user.walletAddress ? user.walletAddress.toLowerCase() : null;
}

export interface PendingView {
  wallet: string;
  ops: PendingOp[];
  lastSeq: number;
  /** Follows / intros that cannot be signed because the other member has no wallet yet. */
  skipped: { follows: number; intros: number };
  isAdmin: boolean;
}

export async function pendingFor(user: User): Promise<PendingView | null> {
  const wallet = graphWallet(user);
  if (!wallet) return null;
  const admins = adminWallets();
  const isAdmin = admins.has(wallet);
  const [follows, claims, intros, decisions, events, lastSeq] = await Promise.all([
    prisma.followUser.findMany({ where: { followerId: user.id }, select: { followee: { select: { handle: true, walletAddress: true, walletVerified: true } } } }),
    prisma.orgClaim.findMany({ where: { userId: user.id, status: "approved" }, select: { org: { select: { slug: true } } } }),
    prisma.intro.findMany({
      where: { connectorId: user.id, status: "accepted" },
      select: { id: true, requester: { select: { walletAddress: true, walletVerified: true } }, target: { select: { walletAddress: true, walletVerified: true } } },
      orderBy: { respondedAt: "asc" },
    }),
    isAdmin
      ? prisma.orgClaim.findMany({
          where: { status: { in: ["approved", "revoked"] }, user: { walletVerified: true, walletAddress: { not: null } } },
          select: { status: true, org: { select: { slug: true } }, user: { select: { walletAddress: true } } },
          orderBy: { decidedAt: "asc" },
        })
      : Promise.resolve([]),
    relevantEvents(wallet),
    lastSeqOf(wallet),
  ]);
  const w = (u: { walletAddress: string | null; walletVerified: boolean }) => (u.walletVerified && u.walletAddress ? u.walletAddress.toLowerCase() : null);
  const followable = follows.filter((f) => w(f.followee));
  const signable = intros.filter((i) => w(i.requester) && w(i.target));
  const db: GraphDbState = {
    wallet,
    follows: followable.map((f) => ({ wallet: w(f.followee)!, handle: f.followee.handle })),
    memberships: claims.map((c) => `org:${c.org.slug}`),
    intros: signable.map((i) => ({ id: i.id, requester: w(i.requester)!, target: w(i.target)! })),
    adminDecisions: decisions.map((d) => ({ member: d.user.walletAddress!.toLowerCase(), orgRef: `org:${d.org.slug}`, approved: d.status === "approved" })),
  };
  const { state } = await checkGraphLog(events, admins);
  return {
    wallet,
    ops: planGraphOps(db, state),
    lastSeq,
    skipped: { follows: follows.length - followable.length, intros: intros.length - signable.length },
    isAdmin,
  };
}

export async function preparePending(user: User, now = new Date()): Promise<{ wallet: string; messages: GraphMessage[] } | null> {
  const p = await pendingFor(user);
  if (!p) return null;
  return { wallet: p.wallet, messages: prepareMessages(p.ops, p.wallet, p.lastSeq, Math.floor(now.getTime() / 1000)) };
}

export type AcceptResult = { ok: true; stored: number } | { ok: false; status: 400 | 401 | 409; error: SubmitError | "no_wallet" | "conflict"; index?: number };

/** Verify a signed batch and append it to the log. All or nothing. */
export async function acceptSigned(user: User, items: { message: GraphMessage; signature: string }[], now = new Date()): Promise<AcceptResult> {
  const p = await pendingFor(user);
  if (!p) return { ok: false, status: 401, error: "no_wallet" };
  const v = validateBatch(
    items.map((i) => i.message),
    { wallet: p.wallet, pending: p.ops, lastSeq: p.lastSeq, now: Math.floor(now.getTime() / 1000) },
  );
  if (!v.ok) return { ok: false, status: 400, error: v.error, index: v.index };
  const checked = await Promise.all(items.map((i) => verifyGraphEvent({ ...i.message, signature: i.signature, statement: GRAPH_STATEMENT })));
  const bad = checked.findIndex((c) => !c.ok);
  if (bad >= 0) return { ok: false, status: 400, error: "bad_signature", index: bad };
  try {
    await prisma.$transaction(
      items.map((i, k) =>
        prisma.graphEvent.create({
          data: {
            digest: (checked[k] as { digest: string }).digest,
            author: p.wallet,
            action: i.message.action,
            subject: i.message.subject.toLowerCase(),
            object: (i.message.object || ZERO_ADDRESS).toLowerCase(),
            ref: i.message.ref,
            seq: i.message.seq,
            issuedAt: i.message.issuedAt,
            statement: GRAPH_STATEMENT,
            signature: i.signature,
          },
        }),
      ),
    );
  } catch (e) {
    // A unique violation (digest, or author+seq) means a concurrent or replayed submit: 409.
    // Anything else is a real database fault and must not be disguised as a conflict.
    if ((e as { code?: unknown }).code === "P2002") {
      logger.info("graph submit conflict", { scope: "graph", count: items.length });
      return { ok: false, status: 409, error: "conflict" };
    }
    logger.error("graph submit failed", { scope: "graph", count: items.length, err: e });
    throw e;
  }
  return { ok: true, stored: items.length };
}
