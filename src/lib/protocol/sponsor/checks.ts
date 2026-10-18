/**
 * Earning sponsored gas (design section 6): an invite link, or a one-time email (default) or
 * phone check. Each grant is once per account and once per email/phone.
 *
 *   startCheck   sends a 6-digit code (10 minutes, 5 tries). Sends are limited per member, per
 *                address and per IP. Whether an address was already used is only revealed after
 *                the code proves the member controls it.
 *   verifyCheck  checks the code and records the grant.
 *   grantInvite  for invite sign-ups: at most 20 grants per inviter per rolling 24 h.
 */
import { codeHash, identityHash, maskAddress, newCode, normalizeIdentity, sameHash, type SponsorChannel } from "./identity";
import { CODE_TTL_MINUTES, type CodeSender } from "./senders";
import type { SponsorStore } from "./store";
import { HARD_LIMITS } from "../relayer/policy";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export const SEND_LIMITS = {
  memberPerHour: 3,
  memberPerDay: 6,
  addressPerHour: 3,
  addressPerDay: 5,
  ipPerHour: 10,
} as const;
export const MAX_ATTEMPTS = 5;

export type StartResult =
  | { ok: true; channel: SponsorChannel; sentTo: string; expiresAt: Date }
  | { ok: false; code: "already_sponsored" | "invalid_address" | "channel_off" | "rate_limited" | "send_failed"; status: number; error: string };

export type VerifyResult =
  | { ok: true; channel: SponsorChannel }
  | { ok: false; code: "already_sponsored" | "no_check" | "expired" | "too_many_attempts" | "wrong_code" | "identity_used"; status: number; error: string; attemptsLeft?: number };

export interface StartArgs {
  store: SponsorStore;
  sender: CodeSender | null;
  secret: string;
  userId: string;
  channel: SponsorChannel;
  address: string;
  ipHash: string | null;
  now?: Date;
  /** Injected in tests. */
  code?: () => string;
}

export async function startCheck(a: StartArgs): Promise<StartResult> {
  const now = a.now ?? new Date();
  if (!a.sender || a.sender.channel !== a.channel) return { ok: false, code: "channel_off", status: 404, error: `${a.channel} checks are not available` };
  if (await a.store.hasSponsorship(a.userId)) return { ok: false, code: "already_sponsored", status: 409, error: "your account already has sponsored network fees" };
  const normalized = normalizeIdentity(a.channel, a.address);
  if (!normalized) return { ok: false, code: "invalid_address", status: 400, error: a.channel === "email" ? "enter a valid email address" : "enter the number with its country code, like +52 55 1234 5678" };
  const hash = identityHash(a.channel, normalized, a.secret);

  const hour = new Date(now.getTime() - HOUR);
  const day = new Date(now.getTime() - DAY);
  const counts = await Promise.all([
    a.store.countChecks({ userId: a.userId }, hour),
    a.store.countChecks({ userId: a.userId }, day),
    a.store.countChecks({ identityHash: hash }, hour),
    a.store.countChecks({ identityHash: hash }, day),
    a.ipHash ? a.store.countChecks({ ipHash: a.ipHash }, hour) : Promise.resolve(0),
  ]);
  const caps = [SEND_LIMITS.memberPerHour, SEND_LIMITS.memberPerDay, SEND_LIMITS.addressPerHour, SEND_LIMITS.addressPerDay, SEND_LIMITS.ipPerHour];
  if (counts.some((n, i) => n >= caps[i])) return { ok: false, code: "rate_limited", status: 429, error: "too many codes requested; try again later" };

  const code = (a.code ?? newCode)();
  const expiresAt = new Date(now.getTime() + CODE_TTL_MINUTES * 60_000);
  const row = await a.store.createCheck({
    userId: a.userId,
    channel: a.channel,
    identityHash: hash,
    ipHash: a.ipHash,
    status: "open",
    expiresAt,
    codeHash: (id) => codeHash(id, code, a.secret),
    now,
  });
  try {
    await a.sender.send(normalized, code);
  } catch {
    // The row still counts toward the send limits, so a failing provider can't be hammered.
    await a.store.setStatus(row.id, "failed");
    return { ok: false, code: "send_failed", status: 502, error: "we couldn't send the code; try again in a few minutes" };
  }
  return { ok: true, channel: a.channel, sentTo: maskAddress(a.channel, normalized), expiresAt };
}

export async function verifyCheck(a: { store: SponsorStore; secret: string; userId: string; code: string; now?: Date }): Promise<VerifyResult> {
  const now = a.now ?? new Date();
  if (await a.store.hasSponsorship(a.userId)) return { ok: false, code: "already_sponsored", status: 409, error: "your account already has sponsored network fees" };
  const check = await a.store.openCheck(a.userId);
  if (!check) return { ok: false, code: "no_check", status: 404, error: "request a code first" };
  if (check.expiresAt <= now) {
    await a.store.setStatus(check.id, "superseded");
    return { ok: false, code: "expired", status: 410, error: "that code expired; request a new one" };
  }
  if (check.attempts >= MAX_ATTEMPTS) {
    await a.store.setStatus(check.id, "locked");
    return { ok: false, code: "too_many_attempts", status: 429, error: "too many wrong codes; request a new one" };
  }
  const code = a.code.trim();
  if (!/^\d{6}$/.test(code) || !sameHash(codeHash(check.id, code, a.secret), check.codeHash)) {
    const used = await a.store.addAttempt(check.id);
    if (used >= MAX_ATTEMPTS) await a.store.setStatus(check.id, "locked");
    return { ok: false, code: "wrong_code", status: 400, error: "that code isn't right", attemptsLeft: Math.max(0, MAX_ATTEMPTS - used) };
  }
  await a.store.setStatus(check.id, "verified");
  const g = await a.store.grantVerified(a.userId, check.channel, check.identityHash);
  if (g === "granted") return { ok: true, channel: check.channel };
  if (g === "identity_used") return { ok: false, code: "identity_used", status: 409, error: `this ${check.channel === "email" ? "email" : "number"} already unlocked sponsored fees for another account` };
  return { ok: false, code: "already_sponsored", status: 409, error: "your account already has sponsored network fees" };
}

export type InviteGrant = { granted: true } | { granted: false; reason: "self_invite" | "unknown_inviter" | "already_sponsored" | "inviter_limit" };

/**
 * Call right after an invite sign-up creates the account (PR #6: prismaAuthDeps.createWithWallet,
 * once the inviter is resolved). Never throws for a refusal; sign-up must not fail because of it.
 */
export async function grantInvite(a: { store: SponsorStore; userId: string; inviterId: string; now?: Date; cap?: number }): Promise<InviteGrant> {
  if (a.userId === a.inviterId) return { granted: false, reason: "self_invite" };
  if (!(await a.store.inviterExists(a.inviterId))) return { granted: false, reason: "unknown_inviter" };
  const r = await a.store.grantInvite(a.userId, a.inviterId, a.now ?? new Date(), a.cap ?? HARD_LIMITS.inviterSignupsPerDay);
  if (r === "granted") return { granted: true };
  return { granted: false, reason: r === "inviter_limit" ? "inviter_limit" : "already_sponsored" };
}
