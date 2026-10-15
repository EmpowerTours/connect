import "server-only";
import { prisma } from "./db";
import { connectionsOf, mutualConnections, reputationScore, reputationTier, type TrackRecord } from "./intros";
import { isHelpful } from "./posts";

export async function getTrackRecord(userId: string): Promise<TrackRecord & { score: number; tier: ReturnType<typeof reputationTier> }> {
  const [dealsClosed, introsMade, posts] = await Promise.all([
    prisma.deal.count({ where: { stage: "committed", workspace: { ownerId: userId } } }),
    prisma.intro.count({ where: { connectorId: userId, status: "accepted" } }),
    prisma.post.findMany({ where: { authorId: userId }, select: { _count: { select: { likes: true, recasts: true, replies: true } } } }),
  ]);
  const helpfulPosts = posts.filter((p) => isHelpful({ likes: p._count.likes, recasts: p._count.recasts, replies: p._count.replies })).length;
  const record = { dealsClosed, introsMade, helpfulPosts };
  const score = reputationScore(record);
  return { ...record, score, tier: reputationTier(score) };
}

export async function getGraph(viewerId: string, userId: string) {
  const edges = await prisma.followUser.findMany({ select: { followerId: true, followeeId: true } });
  const mutualIds = mutualConnections(edges, viewerId, userId);
  const connections = connectionsOf(edges, userId);
  const viewerFollows = edges.some((e) => e.followerId === viewerId && e.followeeId === userId);
  const followsViewer = edges.some((e) => e.followerId === userId && e.followeeId === viewerId);
  return { edges, mutualIds, connectionCount: connections.size, viewerFollows, followsViewer, connected: viewerFollows && followsViewer };
}
