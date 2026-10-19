/**
 * The relayer: checks a member's signed request, decides whether to sponsor it, simulates it,
 * and submits it with gas limit = estimate x 1.10 (Monad charges the limit).
 *
 * It holds no power: every call needs the member's signature, the contracts give the relayer no
 * role, and it only calls the gateway functions in payloads.ts. A refusal tells the client to
 * self-pay, which submits the identical signed call from the member's own wallet.
 */
import type { Address, Hex } from "viem";
import { gasLimitFromEstimate } from "../chains";
import { actionCall, actionDeadline, actionId, registerArgs, type ActionPayload, type RegisterPayload } from "../payloads";
import { KeyType, Scope, isValidScope, keyHashOf } from "../typed-data";
import { DAY_MS, type RelayLedger, type RelayMeta } from "./ledger";
import { decide, type DenyCode, type Eligibility, type RelayerLimits } from "./policy";

export interface RelayFees {
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
}

export interface RelayReceipt {
  status: "success" | "reverted";
  gasUsed: bigint;
  effectiveGasPrice: bigint;
  /** For register: the new Connect ID from the Registered event. */
  registeredId: bigint | null;
}

/** What the relayer needs from the chain (viem in production, a fake in unit tests). */
export interface RelayChain {
  chainId: number;
  relayer: Address;
  simulate(functionName: string, args: readonly unknown[]): Promise<void>;
  estimateGas(functionName: string, args: readonly unknown[]): Promise<bigint>;
  fees(): Promise<RelayFees>;
  balance(): Promise<bigint>;
  send(functionName: string, args: readonly unknown[], gas: bigint, fees: RelayFees): Promise<Hex>;
  /** Null if not mined within the timeout. */
  receipt(hash: Hex, timeoutMs: number): Promise<RelayReceipt | null>;
  idOf(owner: Address): Promise<bigint>;
}

export interface RelayLog {
  info(msg: string, ctx?: Record<string, unknown>): void;
  warn(msg: string, ctx?: Record<string, unknown>): void;
  error(msg: string, ctx?: Record<string, unknown>): void;
}

export interface RelayUser {
  id: string;
  /** Lowercased verified Mera wallet. */
  wallet: string;
}

export type RelayResult =
  | { ok: true; txHash: Hex; status: "confirmed" | "pending"; connectId?: string }
  | { ok: false; status: number; code: DenyCode | "bad_request" | "not_your_id" | "no_connect_id" | "simulation_failed" | "send_failed" | "reverted"; reason: string; selfPay: boolean };

/** Deadlines must be in the future and at most this far out (limits how long a signed request lives). */
export const MAX_DEADLINE_SECONDS = 2 * 60 * 60;
const RECEIPT_TIMEOUT_MS = 30_000;

/** Pulls the custom error name out of a viem revert (e.g. "BadSignature"). */
export function revertName(e: unknown): string {
  let cur: unknown = e;
  for (let i = 0; i < 8 && cur; i++) {
    const c = cur as { data?: { errorName?: string }; cause?: unknown; shortMessage?: string };
    if (c.data?.errorName) return c.data.errorName;
    cur = c.cause;
  }
  const msg = (e as { shortMessage?: string })?.shortMessage ?? (e instanceof Error ? e.message : String(e));
  return msg.split("\n")[0].slice(0, 200);
}

export class Relayer {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly chain: RelayChain,
    private readonly ledger: RelayLedger,
    private readonly limits: RelayerLimits,
    private readonly log: RelayLog,
    private readonly gateway: Address,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  /** One submission at a time: keeps the relayer's nonce and the spend counters consistent. */
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const next = this.queue.then(work, work);
    this.queue = next.catch(() => undefined);
    return next;
  }

  private checkDeadline(deadline: bigint | null): string | null {
    if (deadline === null) return null;
    const now = BigInt(Math.floor(this.clock().getTime() / 1000));
    if (deadline <= now) return "the signed request has expired; sign it again";
    if (deadline > now + BigInt(MAX_DEADLINE_SECONDS)) return "the signed request's deadline is too far in the future";
    return null;
  }

  async relayRegister(user: RelayUser, eligibility: Eligibility | null, ipHash: string | null, p: RegisterPayload): Promise<RelayResult> {
    const bad = (reason: string): RelayResult => ({ ok: false, status: 400, code: "bad_request", reason, selfPay: false });
    if (p.params.owner.toLowerCase() !== user.wallet.toLowerCase()) return { ok: false, status: 403, code: "not_your_id", reason: "the ID owner must be your signed-in wallet", selfPay: false };
    if (p.params.keyType !== KeyType.P256 || p.params.key.length !== 2 + 128) return bad("the first key must be a P-256 device key");
    if (!isValidScope(p.params.scope) || (p.params.scope & Scope.GUARD) === 0) return bad("the first key needs the GUARD scope");
    const dl = this.checkDeadline(p.params.deadline);
    if (dl) return bad(dl);
    return this.submit(user, eligibility, ipHash, "register", "register", registerArgs(p), {
      connectId: null,
      keyHash: keyHashOf(p.params.keyType, p.params.key),
      keyBytes: p.params.key,
    });
  }

  async relayAction(user: RelayUser, eligibility: Eligibility | null, ipHash: string | null, p: ActionPayload): Promise<RelayResult> {
    const dl = this.checkDeadline(actionDeadline(p));
    if (dl) return { ok: false, status: 400, code: "bad_request", reason: dl, selfPay: false };
    const mine = await this.chain.idOf(user.wallet as Address);
    if (mine === BigInt(0)) return { ok: false, status: 409, code: "no_connect_id", reason: "register your Connect ID first", selfPay: false };
    if (actionId(p) !== mine) return { ok: false, status: 403, code: "not_your_id", reason: "the relayer only sponsors actions on your own Connect ID", selfPay: true };
    const { functionName, args } = actionCall(p);
    const target = p.fn === "finalize" ? p.op.keyHash : p.action.keyHash;
    const keyHash = /^0x0{64}$/.test(target) ? null : target;
    const keyBytes = (p.fn === "addKey" || p.fn === "start" || p.fn === "finalize") && p.key.length > 2 ? p.key : null;
    return this.submit(user, eligibility, ipHash, "action", functionName, args, { connectId: mine.toString(), keyHash, keyBytes });
  }

  private submit(
    user: RelayUser,
    eligibility: Eligibility | null,
    ipHash: string | null,
    type: "register" | "action",
    fn: string,
    args: readonly unknown[],
    extra: Pick<RelayMeta, "connectId" | "keyHash" | "keyBytes">,
  ): Promise<RelayResult> {
    return this.serial(async () => {
      // 1. Simulate: a request that would revert is never paid for.
      try {
        await this.chain.simulate(fn, args);
      } catch (e) {
        return { ok: false, status: 422, code: "simulation_failed", reason: `the contract would reject this: ${revertName(e)}`, selfPay: false };
      }
      // 2. Price it at the worst case Monad can charge: gas limit x max fee.
      const gas = gasLimitFromEstimate(await this.chain.estimateGas(fn, args));
      const fees = await this.chain.fees();
      const costWei = gas * fees.maxFeePerGas;
      const balance = await this.chain.balance();

      // 3. Policy + reservation, atomically.
      const meta: RelayMeta = {
        chainId: this.chain.chainId,
        userId: user.id,
        type,
        fn,
        sponsor: eligibility?.source ?? "verified",
        inviterId: eligibility?.source === "invite" ? eligibility.inviterId : null,
        ipHash,
        owner: user.wallet.toLowerCase(),
        gasLimit: gas,
        costWei,
        ...extra,
      };
      const now = this.clock();
      const reserved = await this.ledger.reserve(
        meta,
        (c) => decide({ type, eligibility, costWei, maxFeePerGasWei: fees.maxFeePerGas, relayerBalanceWei: balance }, c, this.limits),
        now,
      );
      if (!reserved.ok) {
        const d = reserved.decision;
        if (d.code === "over_funded" || d.code === "relayer_low_balance" || d.code === "daily_cap") {
          this.log.error(`[relayer] sponsorship stopped: ${d.code}`, { scope: "relayer", code: d.code, balanceMon: mon(balance) });
        }
        return { ok: false, status: 402, code: d.code, reason: d.reason, selfPay: true };
      }

      // 4. Send.
      let hash: Hex;
      try {
        hash = await this.chain.send(fn, args, gas, fees);
      } catch (e) {
        await this.ledger.markFailed(reserved.id, revertName(e));
        this.log.error("[relayer] send failed", { scope: "relayer", fn, error: revertName(e) });
        return { ok: false, status: 502, code: "send_failed", reason: "the relayer could not submit the transaction; try again or pay your own gas", selfPay: true };
      }
      await this.ledger.markSent(reserved.id, hash);

      // 5. Receipt (Monad charges gas LIMIT x price, even on revert).
      const rc = await this.chain.receipt(hash, RECEIPT_TIMEOUT_MS);
      if (!rc) {
        this.log.warn("[relayer] receipt not seen yet; the reservation stays counted", { scope: "relayer", fn, txHash: hash });
        return { ok: true, txHash: hash, status: "pending" };
      }
      const charged = (rc.gasUsed > gas ? rc.gasUsed : gas) * rc.effectiveGasPrice;
      const connectId = rc.registeredId !== null ? rc.registeredId.toString() : extra.connectId;
      await this.ledger.markDone(reserved.id, rc.status === "success" ? "confirmed" : "reverted", charged, connectId);
      await this.alerts(balance - charged, now);
      if (rc.status !== "success") {
        return { ok: false, status: 502, code: "reverted", reason: "the transaction reverted on chain", selfPay: false };
      }
      this.log.info("[relayer] sponsored", { scope: "relayer", fn, txHash: hash, gas: gas.toString(), costMon: mon(charged) });
      return { ok: true, txHash: hash, status: "confirmed", ...(connectId ? { connectId } : {}) };
    });
  }

  /** Spend, balance and failure-rate alerts (logged at error level, which also reaches Sentry). */
  private async alerts(balanceAfter: bigint, now: Date) {
    const since = new Date(now.getTime() - DAY_MS);
    if (balanceAfter < this.limits.alertBalanceWei) this.log.error("[relayer] balance below alert threshold; top up from the funding wallet", { scope: "relayer", balanceMon: mon(balanceAfter) });
    const spent = await this.ledger.spentSince(this.chain.chainId, since);
    if (spent * BigInt(100) >= this.limits.dailyCapWei * BigInt(80)) this.log.warn("[relayer] 80% of the daily spend cap used", { scope: "relayer", spentMon: mon(spent) });
    const f = await this.ledger.failureStats(this.chain.chainId, since);
    if (f.total >= 5 && f.reverted * 5 >= f.total) this.log.error("[relayer] high on-chain failure rate", { scope: "relayer", reverted: f.reverted, total: f.total });
  }
}

function mon(wei: bigint): string {
  return (Number(wei) / 1e18).toFixed(4);
}
