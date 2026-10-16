import "server-only";
import { adminWallets } from "../admin";
import { prisma } from "../db";
import { GRAPH_DOMAIN, GRAPH_STATEMENT, GRAPH_TYPES } from "./typed-data";
import { checkGraphLog, verifiedMemberships, verifyGraphEvent, type LogReport } from "./verify";
import { rowToEvent } from "./server";

export const PAGE_MAX = 100;
export const PAGE_DEFAULT = 50;
const ADDRESS = /^0x[0-9a-f]{40}$/;

export function protocolInfo() {
  return {
    domain: GRAPH_DOMAIN,
    primaryType: "GraphUpdate",
    types: GRAPH_TYPES,
    statement: GRAPH_STATEMENT,
    /** Wallets whose approve_member / revoke_member updates count. */
    admins: [...adminWallets()].sort(),
    note: "Off-chain EIP-712 messages signed by Mera passkey wallets on Monad (chain 143). No transactions. Per-author seq starts at 1 with no gaps.",
  };
}

/** wallet -> handle, for members who proved their wallet. Display hint only; the log stands without it. */
export async function handlesFor(wallets: string[]): Promise<Map<string, { handle: string; name: string }>> {
  const list = [...new Set(wallets.filter((w) => ADDRESS.test(w)))];
  if (!list.length) return new Map();
  const users = await prisma.user.findMany({ where: { walletAddress: { in: list }, walletVerified: true }, select: { walletAddress: true, handle: true, name: true } });
  return new Map(users.map((u) => [u.walletAddress!.toLowerCase(), { handle: u.handle, name: u.name }]));
}

export function parsePage(params: URLSearchParams): { cursor: number; limit: number } {
  const cursor = Math.max(0, Number.parseInt(params.get("cursor") ?? "0", 10) || 0);
  const limit = Math.min(PAGE_MAX, Math.max(1, Number.parseInt(params.get("limit") ?? String(PAGE_DEFAULT), 10) || PAGE_DEFAULT));
  return { cursor, limit };
}

/** One page of the log, oldest first, each event re-verified on the way out. */
export async function listEvents(opts: { cursor: number; limit: number; author?: string }) {
  const rows = await prisma.graphEvent.findMany({
    where: { id: { gt: opts.cursor }, ...(opts.author ? { author: opts.author } : {}) },
    orderBy: { id: "asc" },
    take: opts.limit + 1,
  });
  const page = rows.slice(0, opts.limit);
  const names = await handlesFor(page.flatMap((r) => [r.author, r.subject, r.object]));
  const events = await Promise.all(
    page.map(async (r) => {
      const e = rowToEvent(r);
      const check = await verifyGraphEvent(e);
      return {
        id: e.id,
        digest: e.digest,
        author: e.author,
        action: e.action,
        subject: e.subject,
        object: e.object,
        ref: e.ref,
        seq: e.seq,
        issuedAt: e.issuedAt,
        signature: e.signature,
        valid: check.ok,
        hints: {
          author: names.get(e.author)?.handle ?? null,
          subject: names.get(e.subject)?.handle ?? null,
          object: names.get(e.object)?.handle ?? null,
        },
        recordedAt: e.createdAt.toISOString(),
      };
    }),
  );
  return { events, nextCursor: rows.length > opts.limit ? page[page.length - 1].id : null };
}

/** Resolve "@handle", "handle" or a wallet address to a wallet. */
export async function resolveWallet(id: string): Promise<{ wallet: string; handle: string | null; name: string | null } | null> {
  const v = decodeURIComponent(id).trim().toLowerCase().replace(/^@/, "");
  if (ADDRESS.test(v)) {
    const u = await prisma.user.findFirst({ where: { walletAddress: v, walletVerified: true }, select: { handle: true, name: true } });
    return { wallet: v, handle: u?.handle ?? null, name: u?.name ?? null };
  }
  const u = await prisma.user.findUnique({ where: { handle: v }, select: { walletAddress: true, walletVerified: true, handle: true, name: true } });
  if (!u || !u.walletVerified || !u.walletAddress) return null;
  return { wallet: u.walletAddress.toLowerCase(), handle: u.handle, name: u.name };
}

/** Replay the whole log (fine at today's size; would move to incremental snapshots at scale). */
export async function replayLog(): Promise<LogReport> {
  const rows = await prisma.graphEvent.findMany({ orderBy: { id: "asc" } });
  return checkGraphLog(rows.map(rowToEvent), adminWallets());
}

/** A member's current graph, derived from signed updates only. */
export async function userGraph(wallet: string) {
  const report = await replayLog();
  const s = report.state;
  const following = [...(s.following.get(wallet) ?? [])].sort();
  const followers = [...s.following.entries()].filter(([, set]) => set.has(wallet)).map(([a]) => a).sort();
  const memberships = verifiedMemberships(s).filter((m) => m.member === wallet);
  const claimedOnly = [...(s.claims.get(wallet) ?? [])].filter((org) => !memberships.some((m) => m.org === org));
  const intros = s.intros.filter((i) => i.introducer === wallet || i.requester === wallet || i.target === wallet);
  const names = await handlesFor([...following, ...followers, ...intros.flatMap((i) => [i.introducer, i.requester, i.target]), ...memberships.map((m) => m.approvedBy)]);
  const tag = (w: string) => ({ wallet: w, handle: names.get(w)?.handle ?? null });
  return {
    following: following.map(tag),
    followers: followers.map(tag),
    memberships: memberships.map((m) => ({ org: m.org.replace(/^org:/, ""), approvedBy: tag(m.approvedBy) })),
    pendingClaims: claimedOnly.map((o) => o.replace(/^org:/, "")),
    intros: intros.map((i) => ({ ref: i.ref, introducer: tag(i.introducer), requester: tag(i.requester), target: tag(i.target) })),
    log: { total: report.total, valid: report.valid, invalid: report.invalid.length, sequenceIssues: report.sequenceIssues.filter((x) => x.author === wallet).length },
  };
}
