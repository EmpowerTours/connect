/**
 * Relayer sponsorship rules (design section 6, approved 2026-10-18). Pure: no I/O, so every rule
 * is unit-tested. The relayer only pays gas or refuses; a refused member can always submit the
 * same signed request from their own wallet ("self-pay").
 *
 * Windows are rolling 24 hours. Every limit can be LOWERED by env; none can be raised above the
 * approved value without a code change (HARD_LIMITS), and a value above it stops the server at boot.
 */
import { parseEther, parseGwei } from "viem";

export const HARD_LIMITS = {
  /** Relayer wallet balance cap. Above it the relayer refuses until the excess is moved out. */
  balanceCapMon: 100,
  /** Total gas the relayer may commit per rolling 24 h. */
  dailyCapMon: 50,
  /** Sponsored registrations per account, ever. */
  registrationsPerAccount: 1,
  /** Sponsored transactions per account per 24 h (the registration counts). */
  accountTxPerDay: 10,
  /** Sponsored verified (non-invite) signups per IP per 24 h. */
  ipSignupsPerDay: 3,
  /** Sponsored invite signups per inviter per 24 h (invite signups are exempt from the IP limit). */
  inviterSignupsPerDay: 20,
  /** Worst-case cost of one transaction (gas limit x max fee). Register costs ~0.03 MON. */
  maxTxCostMon: 0.5,
  /** Highest max fee per gas the relayer will pay (Monad base fee floor is 100 gwei). */
  maxGasPriceGwei: 1000,
} as const;

export interface RelayerLimits {
  balanceCapWei: bigint;
  dailyCapWei: bigint;
  alertBalanceWei: bigint;
  registrationsPerAccount: number;
  accountTxPerDay: number;
  ipSignupsPerDay: number;
  inviterSignupsPerDay: number;
  maxTxCostWei: bigint;
  maxGasPriceWei: bigint;
}

type Env = Record<string, string | undefined>;

/** Reads RELAYER_* limits. Returns errors (names and reasons) instead of throwing. */
export function relayerLimitsFromEnv(env: Env): { limits: RelayerLimits; errors: string[] } {
  const errors: string[] = [];
  const num = (name: string, def: number, max: number, integer: boolean): number => {
    const raw = env[name];
    if (raw === undefined || raw.trim() === "") return def;
    const v = Number(raw);
    if (!Number.isFinite(v) || v < 0 || (integer && !Number.isInteger(v))) {
      errors.push(`${name}: must be a ${integer ? "whole " : ""}number ≥ 0`);
      return def;
    }
    if (v > max) {
      errors.push(`${name}: ${v} is above the approved maximum ${max}; raising it needs a code change`);
      return def;
    }
    return v;
  };
  const mon = (v: number) => parseEther(v.toString());
  const balanceCap = num("RELAYER_BALANCE_CAP_MON", HARD_LIMITS.balanceCapMon, HARD_LIMITS.balanceCapMon, false);
  const limits: RelayerLimits = {
    balanceCapWei: mon(balanceCap),
    dailyCapWei: mon(num("RELAYER_DAILY_CAP_MON", HARD_LIMITS.dailyCapMon, HARD_LIMITS.dailyCapMon, false)),
    alertBalanceWei: mon(num("RELAYER_ALERT_BALANCE_MON", 30, balanceCap, false)),
    registrationsPerAccount: HARD_LIMITS.registrationsPerAccount,
    accountTxPerDay: num("RELAYER_ACCOUNT_TX_PER_DAY", HARD_LIMITS.accountTxPerDay, HARD_LIMITS.accountTxPerDay, true),
    ipSignupsPerDay: num("RELAYER_IP_SIGNUPS_PER_DAY", HARD_LIMITS.ipSignupsPerDay, HARD_LIMITS.ipSignupsPerDay, true),
    inviterSignupsPerDay: num("RELAYER_INVITER_SIGNUPS_PER_DAY", HARD_LIMITS.inviterSignupsPerDay, HARD_LIMITS.inviterSignupsPerDay, true),
    maxTxCostWei: mon(num("RELAYER_MAX_TX_COST_MON", HARD_LIMITS.maxTxCostMon, HARD_LIMITS.maxTxCostMon, false)),
    maxGasPriceWei: parseGwei(num("RELAYER_MAX_GAS_PRICE_GWEI", 250, HARD_LIMITS.maxGasPriceGwei, false).toString()),
  };
  return { limits, errors };
}

/** Why an account may get sponsored gas: an invite link or a one-time phone/email check. */
export type Eligibility = { source: "invite"; inviterId: string } | { source: "verified" };

export interface RelayCounters {
  /** Sponsored registrations this account ever had (not counting ones that failed before sending). */
  accountRegistrations: number;
  /** Sponsored transactions for this account in the last 24 h. */
  accountTxToday: number;
  /** Sponsored verified (non-invite) registrations from this IP in the last 24 h. */
  ipSignupsToday: number;
  /** Sponsored invite registrations credited to this inviter in the last 24 h. */
  inviterSignupsToday: number;
  /** Gas committed by the relayer in the last 24 h (reserved worst case until confirmed). */
  spentTodayWei: bigint;
}

export interface RelayRequest {
  type: "register" | "action";
  eligibility: Eligibility | null;
  /** Worst-case cost of this transaction: gas limit x max fee per gas. */
  costWei: bigint;
  maxFeePerGasWei: bigint;
  relayerBalanceWei: bigint;
}

export type DenyCode =
  | "not_eligible"
  | "already_sponsored"
  | "account_daily_limit"
  | "ip_limit"
  | "inviter_limit"
  | "daily_cap"
  | "over_funded"
  | "relayer_low_balance"
  | "tx_too_expensive"
  | "gas_price_too_high";

export type Decision = { ok: true } | { ok: false; code: DenyCode; reason: string };

const deny = (code: DenyCode, reason: string): Decision => ({ ok: false, code, reason });

export function decide(req: RelayRequest, c: RelayCounters, l: RelayerLimits): Decision {
  // Wallet-level guards first: they protect the money regardless of who asks.
  if (req.relayerBalanceWei > l.balanceCapWei) return deny("over_funded", "relayer wallet holds more than its balance cap; move the excess out");
  if (req.maxFeePerGasWei > l.maxGasPriceWei) return deny("gas_price_too_high", "network gas price is above the relayer's limit");
  if (req.costWei > l.maxTxCostWei) return deny("tx_too_expensive", "this transaction costs more than the per-transaction limit");
  if (req.costWei > req.relayerBalanceWei) return deny("relayer_low_balance", "relayer balance is too low");
  if (c.spentTodayWei + req.costWei > l.dailyCapWei) return deny("daily_cap", "daily sponsorship budget is used up; try again tomorrow or pay your own gas");

  // Who gets sponsored at all.
  if (!req.eligibility) return deny("not_eligible", "sponsored gas needs an invite link or a one-time phone or email check");
  if (c.accountTxToday >= l.accountTxPerDay) return deny("account_daily_limit", "daily sponsored transaction limit reached for this account");

  if (req.type === "register") {
    if (c.accountRegistrations >= l.registrationsPerAccount) return deny("already_sponsored", "this account already had its sponsored registration");
    if (req.eligibility.source === "invite") {
      if (c.inviterSignupsToday >= l.inviterSignupsPerDay) return deny("inviter_limit", "this invite link reached its daily sponsored signups");
    } else if (c.ipSignupsToday >= l.ipSignupsPerDay) {
      return deny("ip_limit", "too many sponsored signups from this network today");
    }
  }
  return { ok: true };
}
