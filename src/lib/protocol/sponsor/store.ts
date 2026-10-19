/**
 * Storage for sponsorship grants and one-time checks. PrismaSponsorStore is the real one;
 * MemorySponsorStore backs tests. Both keep the same rules:
 *   - one grant per account (the first grant wins),
 *   - one grant per email/phone (identityHash is unique),
 *   - at most `cap` invite grants per inviter per rolling 24 h, serialized per inviter.
 */
import { Prisma, type PrismaClient } from "@prisma/client";
import type { SponsorChannel } from "./identity";

export type CheckStatus = "open" | "verified" | "superseded" | "failed" | "locked";

export interface CheckRow {
  id: string;
  userId: string;
  channel: SponsorChannel;
  identityHash: string;
  codeHash: string;
  ipHash: string | null;
  attempts: number;
  status: CheckStatus;
  expiresAt: Date;
  createdAt: Date;
}

export type GrantResult = "granted" | "already_sponsored" | "identity_used" | "inviter_limit";

export interface SponsorStore {
  hasSponsorship(userId: string): Promise<boolean>;
  /** Checks created since `since` matching one field. */
  countChecks(where: { userId: string } | { identityHash: string } | { ipHash: string }, since: Date): Promise<number>;
  /** Supersedes the member's open checks, then inserts this one. */
  createCheck(row: Omit<CheckRow, "id" | "attempts" | "createdAt" | "codeHash"> & { codeHash: (id: string) => string; now: Date }): Promise<CheckRow>;
  setStatus(id: string, status: CheckStatus): Promise<void>;
  /** The member's newest open check. */
  openCheck(userId: string): Promise<CheckRow | null>;
  /** Adds one failed attempt; returns the new count. */
  addAttempt(id: string): Promise<number>;
  grantVerified(userId: string, channel: SponsorChannel, identityHash: string): Promise<GrantResult>;
  grantInvite(userId: string, inviterId: string, now: Date, cap: number): Promise<GrantResult>;
  /** The inviter is a real (non-demo) member. */
  inviterExists(inviterId: string): Promise<boolean>;
}

const DAY_MS = 86_400_000;

type Db = Pick<PrismaClient, "protocolSponsorship" | "protocolSponsorCheck" | "user" | "$transaction">;

function rowFrom(r: { id: string; userId: string; channel: string; identityHash: string; codeHash: string; ipHash: string | null; attempts: number; status: string; expiresAt: Date; createdAt: Date }): CheckRow {
  return { ...r, channel: r.channel as SponsorChannel, status: r.status as CheckStatus };
}

const isUnique = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";

export class PrismaSponsorStore implements SponsorStore {
  constructor(private readonly db: Db) {}

  async hasSponsorship(userId: string) {
    return (await this.db.protocolSponsorship.count({ where: { userId } })) > 0;
  }

  countChecks(where: { userId: string } | { identityHash: string } | { ipHash: string }, since: Date) {
    return this.db.protocolSponsorCheck.count({ where: { ...where, createdAt: { gte: since } } });
  }

  async createCheck(row: Parameters<SponsorStore["createCheck"]>[0]) {
    const { codeHash, now, ...rest } = row;
    return this.db.$transaction(async (tx) => {
      await tx.protocolSponsorCheck.updateMany({ where: { userId: rest.userId, status: "open" }, data: { status: "superseded" } });
      const created = await tx.protocolSponsorCheck.create({ data: { ...rest, codeHash: "pending", createdAt: now } });
      return rowFrom(await tx.protocolSponsorCheck.update({ where: { id: created.id }, data: { codeHash: codeHash(created.id) } }));
    });
  }

  async setStatus(id: string, status: CheckStatus) {
    await this.db.protocolSponsorCheck.update({ where: { id }, data: { status } });
  }

  async openCheck(userId: string) {
    const r = await this.db.protocolSponsorCheck.findFirst({ where: { userId, status: "open" }, orderBy: { createdAt: "desc" } });
    return r ? rowFrom(r) : null;
  }

  async addAttempt(id: string) {
    return (await this.db.protocolSponsorCheck.update({ where: { id }, data: { attempts: { increment: 1 } }, select: { attempts: true } })).attempts;
  }

  async grantVerified(userId: string, channel: SponsorChannel, identityHash: string): Promise<GrantResult> {
    try {
      await this.db.protocolSponsorship.create({ data: { userId, source: "verified", channel, identityHash } });
      return "granted";
    } catch (e) {
      if (!isUnique(e)) throw e;
      return (await this.hasSponsorship(userId)) ? "already_sponsored" : "identity_used";
    }
  }

  async grantInvite(userId: string, inviterId: string, now: Date, cap: number): Promise<GrantResult> {
    // The advisory lock serializes grants for one inviter, so concurrent sign-ups can't pass the cap together.
    return this.db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`sponsor-invite:${inviterId}`}))`;
      if ((await tx.protocolSponsorship.count({ where: { userId } })) > 0) return "already_sponsored" as const;
      const today = await tx.protocolSponsorship.count({ where: { source: "invite", inviterId, createdAt: { gte: new Date(now.getTime() - DAY_MS) } } });
      if (today >= cap) return "inviter_limit" as const;
      await tx.protocolSponsorship.create({ data: { userId, source: "invite", inviterId, createdAt: now } });
      return "granted" as const;
    });
  }

  async inviterExists(inviterId: string) {
    return (await this.db.user.count({ where: { id: inviterId, isDemo: false } })) > 0;
  }
}

/** In-memory store for tests. */
export class MemorySponsorStore implements SponsorStore {
  checks: CheckRow[] = [];
  grants: { userId: string; source: "invite" | "verified"; inviterId: string | null; channel: SponsorChannel | null; identityHash: string | null; createdAt: Date }[] = [];
  members = new Set<string>();
  private n = 0;

  async hasSponsorship(userId: string) {
    return this.grants.some((g) => g.userId === userId);
  }

  async countChecks(where: { userId: string } | { identityHash: string } | { ipHash: string }, since: Date) {
    const [k, v] = Object.entries(where)[0] as [keyof CheckRow, string];
    return this.checks.filter((c) => c[k] === v && c.createdAt >= since).length;
  }

  async createCheck(row: Parameters<SponsorStore["createCheck"]>[0]) {
    const { codeHash, now, ...rest } = row;
    for (const c of this.checks) if (c.userId === rest.userId && c.status === "open") c.status = "superseded";
    const id = `chk${++this.n}`;
    const r: CheckRow = { ...rest, id, codeHash: codeHash(id), attempts: 0, createdAt: now };
    this.checks.push(r);
    return { ...r };
  }

  async setStatus(id: string, status: CheckStatus) {
    const c = this.checks.find((x) => x.id === id);
    if (c) c.status = status;
  }

  async openCheck(userId: string) {
    const open = this.checks.filter((c) => c.userId === userId && c.status === "open");
    return open.length ? { ...open[open.length - 1] } : null;
  }

  async addAttempt(id: string) {
    const c = this.checks.find((x) => x.id === id)!;
    return ++c.attempts;
  }

  async grantVerified(userId: string, channel: SponsorChannel, identityHash: string): Promise<GrantResult> {
    if (await this.hasSponsorship(userId)) return "already_sponsored";
    if (this.grants.some((g) => g.identityHash === identityHash)) return "identity_used";
    this.grants.push({ userId, source: "verified", inviterId: null, channel, identityHash, createdAt: new Date() });
    return "granted";
  }

  async grantInvite(userId: string, inviterId: string, now: Date, cap: number): Promise<GrantResult> {
    if (await this.hasSponsorship(userId)) return "already_sponsored";
    const since = now.getTime() - DAY_MS;
    if (this.grants.filter((g) => g.source === "invite" && g.inviterId === inviterId && g.createdAt.getTime() >= since).length >= cap) return "inviter_limit";
    this.grants.push({ userId, source: "invite", inviterId, channel: null, identityHash: null, createdAt: now });
    return "granted";
  }

  async inviterExists(inviterId: string) {
    return this.members.has(inviterId);
  }
}
