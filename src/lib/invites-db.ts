import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { newInviteCode, parseInviteCode } from "./invites";

/** The member's invite code, created on first use. Retries the rare collision on the unique index. */
export async function ensureInviteCode(userId: string): Promise<string> {
  const existing = await prisma.user.findUnique({ where: { id: userId }, select: { inviteCode: true } });
  if (existing?.inviteCode) return existing.inviteCode;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      // updateMany with inviteCode: null keeps a concurrent first visit from replacing a code already handed out.
      await prisma.user.updateMany({ where: { id: userId, inviteCode: null }, data: { inviteCode: newInviteCode() } });
      const row = await prisma.user.findUnique({ where: { id: userId }, select: { inviteCode: true } });
      if (row?.inviteCode) return row.inviteCode;
      throw new Error("invite code not stored");
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") continue;
      throw e;
    }
  }
  throw new Error("could not allocate an invite code");
}

/** Public fields of the member behind a code (demo accounts never invite). */
export async function findInviter(rawCode: string | null | undefined) {
  const code = parseInviteCode(rawCode);
  if (!code) return null;
  return prisma.user.findFirst({
    where: { inviteCode: code, isDemo: false },
    select: { id: true, name: true, handle: true, avatarKey: true, headline: true, orgName: true },
  });
}

/** How many accounts signed up through this member's link. */
export function inviteCount(userId: string): Promise<number> {
  return prisma.user.count({ where: { invitedById: userId } });
}

/** Admin overview: attributed sign-ups overall and in the last 30 days, and the top inviters. */
export async function inviteStats(now = new Date(), top = 20) {
  const since = new Date(now.getTime() - 30 * 86_400_000);
  const [total, recent, members, groups] = await Promise.all([
    prisma.user.count({ where: { invitedById: { not: null } } }),
    prisma.user.count({ where: { invitedById: { not: null }, createdAt: { gte: since } } }),
    prisma.user.count({ where: { isDemo: false } }),
    prisma.user.groupBy({ by: ["invitedById"], where: { invitedById: { not: null } }, _count: { _all: true }, orderBy: { _count: { invitedById: "desc" } }, take: top }),
  ]);
  const ids = groups.map((g) => g.invitedById).filter((id): id is string => !!id);
  const people = await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, handle: true, avatarKey: true } });
  const byId = new Map(people.map((p) => [p.id, p]));
  const inviters = groups.flatMap((g) => {
    const u = g.invitedById ? byId.get(g.invitedById) : undefined;
    return u ? [{ user: u, count: g._count._all }] : [];
  });
  return { total, recent, members, inviters };
}
