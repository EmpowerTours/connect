import "server-only";
import { prisma } from "../db";
import { filterDrafts, mergeReasons, parseReasons, type ImportSource, type SuggestionDraft } from "./suggestions";

/** Stores drafts as pending suggestions; repeat imports add reasons instead of duplicating. */
export async function persistDrafts(userId: string, drafts: SuggestionDraft[]): Promise<number> {
  const [following, joined] = await Promise.all([
    prisma.followUser.findMany({ where: { followerId: userId }, select: { followeeId: true } }),
    prisma.channelMember.findMany({ where: { userId }, select: { channelId: true } }),
  ]);
  const clean = filterDrafts(drafts, {
    viewerId: userId,
    following: new Set(following.map((f) => f.followeeId)),
    joinedChannels: new Set(joined.map((j) => j.channelId)),
  });
  for (const d of clean) {
    const existing = await prisma.importSuggestion.findUnique({ where: { userId_key: { userId, key: d.key } } });
    if (existing) {
      await prisma.importSuggestion.update({ where: { id: existing.id }, data: { reasons: JSON.stringify(mergeReasons(parseReasons(existing.reasons), d.reason)) } });
    } else {
      await prisma.importSuggestion.create({
        data: { userId, key: d.key, targetUserId: d.targetUserId ?? null, channelId: d.channelId ?? null, reasons: JSON.stringify([d.reason]) },
      });
    }
  }
  return clean.length;
}

export async function recordRun(userId: string, source: ImportSource, found: number, matched: number, detail: Record<string, unknown>) {
  await prisma.importRun.create({ data: { userId, source, found, matched, detail: JSON.stringify(detail) } });
}

/** Follows / joins the member's own pending suggestions among `ids`. Returns how many were confirmed. */
export async function confirmSuggestions(userId: string, ids: string[]): Promise<number> {
  const picked = await prisma.importSuggestion.findMany({ where: { id: { in: ids.slice(0, 500) }, userId, status: "pending" } });
  for (const s of picked) {
    if (s.targetUserId && s.targetUserId !== userId) {
      await prisma.followUser.upsert({
        where: { followerId_followeeId: { followerId: userId, followeeId: s.targetUserId } },
        create: { followerId: userId, followeeId: s.targetUserId },
        update: {},
      });
    }
    if (s.channelId) {
      await prisma.channelMember.upsert({
        where: { userId_channelId: { userId, channelId: s.channelId } },
        create: { userId, channelId: s.channelId },
        update: {},
      });
    }
    await prisma.importSuggestion.update({ where: { id: s.id }, data: { status: "followed" } });
  }
  return picked.length;
}
