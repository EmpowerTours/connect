/**
 * Where the relayer's limits are counted. The Postgres ledger serializes reservations with a
 * transaction-scoped advisory lock, so two requests can't both slip under a cap. The interface
 * lets the service be tested with the in-memory ledger.
 */
import type { Decision, RelayCounters } from "./policy";

export const DAY_MS = 24 * 60 * 60 * 1000;

export interface RelayMeta {
  chainId: number;
  userId: string;
  type: "register" | "action";
  fn: string;
  sponsor: "invite" | "verified";
  inviterId: string | null;
  ipHash: string | null;
  owner: string;
  connectId: string | null;
  keyHash: string | null;
  keyBytes: string | null;
  gasLimit: bigint;
  costWei: bigint;
}

export type RelayStatus = "reserved" | "sent" | "confirmed" | "reverted" | "failed";

export interface RelayLedger {
  /** Counts, decides and (if allowed) records a reservation, atomically. */
  reserve(meta: RelayMeta, decide: (c: RelayCounters) => Decision, now: Date): Promise<{ ok: true; id: string } | { ok: false; decision: Decision & { ok: false } }>;
  markSent(id: string, txHash: string): Promise<void>;
  /** Final state after the receipt. costWei is what was charged. */
  markDone(id: string, status: "confirmed" | "reverted", costWei: bigint, connectId?: string | null): Promise<void>;
  /** Never reached the chain: the reservation is released (cost 0). */
  markFailed(id: string, error: string): Promise<void>;
  failureStats(chainId: number, since: Date): Promise<{ total: number; reverted: number }>;
  spentSince(chainId: number, since: Date): Promise<bigint>;
  /** Key hashes the relayer added or touched for this Connect ID (confirmed only). */
  keyHashesFor(chainId: number, connectId: string, owner: string): Promise<string[]>;
}

export interface LedgerRow extends RelayMeta {
  id: string;
  status: RelayStatus;
  txHash: string | null;
  error: string | null;
  createdAt: Date;
}

/** Counters from a set of rows (shared by both ledgers so the rules are identical). */
export function countersFrom(rows: LedgerRow[], meta: RelayMeta, now: Date): RelayCounters {
  const since = now.getTime() - DAY_MS;
  const live = rows.filter((r) => r.chainId === meta.chainId && r.status !== "failed");
  const today = live.filter((r) => r.createdAt.getTime() > since);
  return {
    accountRegistrations: live.filter((r) => r.userId === meta.userId && r.type === "register").length,
    accountTxToday: today.filter((r) => r.userId === meta.userId).length,
    ipSignupsToday: meta.ipHash ? today.filter((r) => r.type === "register" && r.sponsor === "verified" && r.ipHash === meta.ipHash).length : 0,
    inviterSignupsToday: meta.inviterId ? today.filter((r) => r.type === "register" && r.sponsor === "invite" && r.inviterId === meta.inviterId).length : 0,
    spentTodayWei: rows.filter((r) => r.chainId === meta.chainId && r.createdAt.getTime() > since).reduce((s, r) => s + r.costWei, BigInt(0)),
  };
}

export class MemoryRelayLedger implements RelayLedger {
  rows: LedgerRow[] = [];
  private seq = 0;

  async reserve(meta: RelayMeta, decide: (c: RelayCounters) => Decision, now: Date) {
    const d = decide(countersFrom(this.rows, meta, now));
    if (!d.ok) return { ok: false as const, decision: d };
    const id = `r${++this.seq}`;
    this.rows.push({ ...meta, id, status: "reserved", txHash: null, error: null, createdAt: now });
    return { ok: true as const, id };
  }
  private row(id: string) {
    const r = this.rows.find((x) => x.id === id);
    if (!r) throw new Error("unknown relay row");
    return r;
  }
  async markSent(id: string, txHash: string) {
    Object.assign(this.row(id), { status: "sent", txHash });
  }
  async markDone(id: string, status: "confirmed" | "reverted", costWei: bigint, connectId?: string | null) {
    const r = this.row(id);
    Object.assign(r, { status, costWei, connectId: connectId ?? r.connectId });
  }
  async markFailed(id: string, error: string) {
    Object.assign(this.row(id), { status: "failed", costWei: BigInt(0), error });
  }
  async failureStats(chainId: number, since: Date) {
    const rs = this.rows.filter((r) => r.chainId === chainId && r.createdAt > since && (r.status === "confirmed" || r.status === "reverted"));
    return { total: rs.length, reverted: rs.filter((r) => r.status === "reverted").length };
  }
  async spentSince(chainId: number, since: Date) {
    return this.rows.filter((r) => r.chainId === chainId && r.createdAt > since).reduce((s, r) => s + r.costWei, BigInt(0));
  }
  async keyHashesFor(chainId: number, connectId: string, owner: string) {
    return this.rows
      .filter((r) => r.chainId === chainId && r.status === "confirmed" && r.keyHash && (r.connectId === connectId || (r.type === "register" && r.owner === owner)))
      .map((r) => r.keyHash as string);
  }
}
