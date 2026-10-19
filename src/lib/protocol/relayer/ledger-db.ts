/** Postgres ledger (ProtocolRelay table). */
import { Prisma, type PrismaClient } from "@prisma/client";
import { DAY_MS, countersFrom, type LedgerRow, type RelayLedger, type RelayMeta, type RelayStatus } from "./ledger";
import type { Decision, RelayCounters } from "./policy";

const LOCK_KEY = 0x636f6e6e; // "conn": one lock for all relay reservations

const dec = (v: bigint) => new Prisma.Decimal(v.toString());
const big = (v: Prisma.Decimal) => BigInt(v.toFixed(0));

export class PrismaRelayLedger implements RelayLedger {
  constructor(private readonly prisma: PrismaClient) {}

  async reserve(meta: RelayMeta, decide: (c: RelayCounters) => Decision, now: Date) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${LOCK_KEY})`;
      const since = new Date(now.getTime() - DAY_MS);
      // Only the rows the counters can need: this account's history, plus the last 24 h on this chain.
      const rows = await tx.protocolRelay.findMany({
        where: { chainId: meta.chainId, OR: [{ userId: meta.userId }, { createdAt: { gt: since } }] },
        select: { id: true, chainId: true, userId: true, type: true, fn: true, sponsor: true, inviterId: true, ipHash: true, owner: true, connectId: true, keyHash: true, keyBytes: true, gasLimit: true, costWei: true, status: true, txHash: true, error: true, createdAt: true },
      });
      const mapped: LedgerRow[] = rows.map((r) => ({
        ...r,
        type: r.type as LedgerRow["type"],
        sponsor: r.sponsor as LedgerRow["sponsor"],
        status: r.status as RelayStatus,
        gasLimit: big(r.gasLimit),
        costWei: big(r.costWei),
      }));
      const d = decide(countersFrom(mapped, meta, now));
      if (!d.ok) return { ok: false as const, decision: d };
      const row = await tx.protocolRelay.create({
        data: { ...meta, gasLimit: dec(meta.gasLimit), costWei: dec(meta.costWei), status: "reserved", createdAt: now },
        select: { id: true },
      });
      return { ok: true as const, id: row.id };
    });
  }

  async markSent(id: string, txHash: string) {
    await this.prisma.protocolRelay.update({ where: { id }, data: { status: "sent", txHash } });
  }

  async markDone(id: string, status: "confirmed" | "reverted", costWei: bigint, connectId?: string | null) {
    await this.prisma.protocolRelay.update({ where: { id }, data: { status, costWei: dec(costWei), ...(connectId ? { connectId } : {}) } });
  }

  async markFailed(id: string, error: string) {
    await this.prisma.protocolRelay.update({ where: { id }, data: { status: "failed", costWei: dec(BigInt(0)), error: error.slice(0, 500) } });
  }

  async failureStats(chainId: number, since: Date) {
    const [total, reverted] = await Promise.all([
      this.prisma.protocolRelay.count({ where: { chainId, createdAt: { gt: since }, status: { in: ["confirmed", "reverted"] } } }),
      this.prisma.protocolRelay.count({ where: { chainId, createdAt: { gt: since }, status: "reverted" } }),
    ]);
    return { total, reverted };
  }

  async spentSince(chainId: number, since: Date) {
    const r = await this.prisma.protocolRelay.aggregate({ where: { chainId, createdAt: { gt: since } }, _sum: { costWei: true } });
    return r._sum.costWei ? big(r._sum.costWei) : BigInt(0);
  }

  async keyHashesFor(chainId: number, connectId: string, owner: string) {
    const rows = await this.prisma.protocolRelay.findMany({
      where: { chainId, status: "confirmed", keyHash: { not: null }, OR: [{ connectId }, { type: "register", owner }] },
      select: { keyHash: true },
    });
    return rows.map((r) => r.keyHash as string);
  }
}
