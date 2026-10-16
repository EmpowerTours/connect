import "server-only";
import { cache } from "react";
import type { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { rankFeed, type FeedAlgorithm, type FeedCandidate, type FeedMutes } from "./feed-algorithms";
import { parseList } from "./json";

export const authorSelect = {
  id: true,
  name: true,
  handle: true,
  isDemo: true,
  headline: true,
  orgName: true,
  workEmailVerified: true,
  linkedinVerified: true,
  walletVerified: true,
} satisfies Prisma.UserSelect;

export function postInclude(viewerId: string) {
  return {
    author: { select: authorSelect },
    channel: { select: { slug: true, name: true } },
    orgs: { include: { org: { select: { slug: true, name: true } } } },
    quoteOf: { include: { author: { select: authorSelect } } },
    parent: { select: { id: true, author: { select: { handle: true } } } },
    likes: { where: { userId: viewerId }, select: { userId: true } },
    recasts: { where: { userId: viewerId }, select: { userId: true } },
    _count: { select: { likes: true, recasts: true, replies: true, quotes: true } },
  } satisfies Prisma.PostInclude;
}

export type FeedPost = Prisma.PostGetPayload<{ include: ReturnType<typeof postInclude> }>;
export interface FeedItem {
  key: string;
  post: FeedPost;
  recastBy?: { name: string; handle: string };
  at: Date;
}

/** Slugs/handles used to linkify casts. Cached per request. */
export const getKnownRefs = cache(async () => {
  const [orgs, users, channels] = await Promise.all([
    prisma.organization.findMany({ select: { slug: true } }),
    prisma.user.findMany({ select: { handle: true } }),
    prisma.channel.findMany({ select: { slug: true } }),
  ]);
  return {
    orgs: new Set(orgs.map((o) => o.slug)),
    handles: new Set(users.map((u) => u.handle)),
    channels: new Set(channels.map((c) => c.slug)),
  };
});

function merge(posts: FeedPost[], recasts: { createdAt: Date; user: { name: string; handle: string }; post: FeedPost }[], take: number): FeedItem[] {
  const items: FeedItem[] = [
    ...posts.map((p) => ({ key: p.id, post: p, at: p.createdAt })),
    ...recasts.map((r) => ({ key: `rc-${r.user.handle}-${r.post.id}`, post: r.post, recastBy: r.user, at: r.createdAt })),
  ];
  items.sort((a, b) => b.at.getTime() - a.at.getTime());
  // A post appears once: keep the newest occurrence (original or recast).
  const seen = new Set<string>();
  return items.filter((i) => (seen.has(i.post.id) ? false : (seen.add(i.post.id), true))).slice(0, take);
}

/** Where-clause for the Following pool: people, orgs and channels the viewer follows (plus their own posts). */
async function followingPool(viewerId: string) {
  const [follows, orgFollows, channels] = await Promise.all([
    prisma.followUser.findMany({ where: { followerId: viewerId }, select: { followeeId: true } }),
    prisma.followOrg.findMany({ where: { userId: viewerId }, select: { orgId: true } }),
    prisma.channelMember.findMany({ where: { userId: viewerId }, select: { channelId: true } }),
  ]);
  const followeeIds = follows.map((f) => f.followeeId);
  const where = {
    parentId: null,
    OR: [
      { authorId: { in: [viewerId, ...followeeIds] } },
      { orgs: { some: { orgId: { in: orgFollows.map((o) => o.orgId) } } } },
      { channelId: { in: channels.map((c) => c.channelId) } },
    ],
  } satisfies Prisma.PostWhereInput;
  return { where, followeeIds };
}

export async function getHomeFeed(viewerId: string, mode: "following" | "all", take = 40): Promise<FeedItem[]> {
  const include = postInclude(viewerId);
  if (mode === "all") {
    const posts = await prisma.post.findMany({ where: { parentId: null }, include, orderBy: { createdAt: "desc" }, take });
    return merge(posts, [], take);
  }
  const { where, followeeIds } = await followingPool(viewerId);
  const posts = await prisma.post.findMany({ where, include, orderBy: { createdAt: "desc" }, take });
  const recasts = await prisma.recast.findMany({
    where: { userId: { in: followeeIds } },
    include: { user: { select: { name: true, handle: true } }, post: { include } },
    orderBy: { createdAt: "desc" },
    take,
  });
  return merge(posts, recasts, take);
}

/** How many recent posts an algorithm gets to choose from. */
export const CANDIDATE_POOL = 200;

export interface FeedViewer {
  id: string;
  mutedTopics: string;
  mutedChannels: string;
}

export function viewerMutes(v: Pick<FeedViewer, "mutedTopics" | "mutedChannels">): FeedMutes {
  return { topics: new Set(parseList(v.mutedTopics)), channels: new Set(parseList(v.mutedChannels)) };
}

/**
 * The programmable feed: gather a candidate pool (Following, For you, or one
 * channel), then let the chosen algorithm mute, score and order it.
 */
export async function getProgrammableFeed(
  viewer: FeedViewer,
  opts: { pool: "following" | "all" | { channelId: string }; algorithm: FeedAlgorithm; take?: number; now?: Date },
): Promise<FeedItem[]> {
  const take = opts.take ?? 40;
  const include = postInclude(viewer.id);
  let posts: FeedPost[];
  let recasts: { createdAt: Date; user: { name: string; handle: string }; post: FeedPost }[] = [];
  if (opts.pool === "all") {
    posts = await prisma.post.findMany({ where: { parentId: null }, include, orderBy: { createdAt: "desc" }, take: CANDIDATE_POOL });
  } else if (opts.pool === "following") {
    const { where, followeeIds } = await followingPool(viewer.id);
    posts = await prisma.post.findMany({ where, include, orderBy: { createdAt: "desc" }, take: CANDIDATE_POOL });
    recasts = await prisma.recast.findMany({
      where: { userId: { in: followeeIds } },
      include: { user: { select: { name: true, handle: true } }, post: { include } },
      orderBy: { createdAt: "desc" },
      take: CANDIDATE_POOL / 2,
    });
  } else {
    posts = await prisma.post.findMany({ where: { channelId: opts.pool.channelId, parentId: null }, include, orderBy: { createdAt: "desc" }, take: CANDIDATE_POOL });
  }
  // One row per post: the newest occurrence (original or repost), as in the chronological feed.
  const items = merge(posts, recasts, CANDIDATE_POOL * 2);
  if (items.length === 0) return [];

  const postIds = [...new Set(items.map((i) => i.post.id))];
  const authorIds = [...new Set(items.map((i) => i.post.authorId))];
  const [replierRows, verified] = await Promise.all([
    prisma.post.groupBy({ by: ["parentId", "authorId"], where: { parentId: { in: postIds } } }),
    prisma.orgClaim.findMany({ where: { userId: { in: authorIds }, status: "approved" }, select: { userId: true } }),
  ]);
  const repliers = new Map<string, number>();
  for (const r of replierRows) if (r.parentId) repliers.set(r.parentId, (repliers.get(r.parentId) ?? 0) + 1);
  const verifiedMembers = new Set(verified.map((v) => v.userId));

  const byKey = new Map(items.map((i) => [i.key, i]));
  const candidates: FeedCandidate[] = items.map((i) => ({
    key: i.key,
    postId: i.post.id,
    authorId: i.post.authorId,
    createdAt: i.at,
    body: i.post.body,
    kind: i.post.kind,
    channelSlug: i.post.channel?.slug ?? null,
    isRepost: !!i.recastBy,
    replies: i.post._count.replies,
    repliers: repliers.get(i.post.id) ?? 0,
    likes: i.post._count.likes,
    reposts: i.post._count.recasts,
    quotes: i.post._count.quotes,
    authorVerifiedMember: verifiedMembers.has(i.post.authorId),
    authorWalletVerified: i.post.author.walletVerified,
  }));
  const ranked = rankFeed(candidates, opts.algorithm, { now: opts.now ?? new Date(), viewerId: viewer.id }, viewerMutes(viewer), take);
  return ranked.map((c) => byKey.get(c.key)!);
}

export async function getChannelFeed(viewerId: string, channelId: string, take = 40): Promise<FeedItem[]> {
  const posts = await prisma.post.findMany({ where: { channelId, parentId: null }, include: postInclude(viewerId), orderBy: { createdAt: "desc" }, take });
  return merge(posts, [], take);
}

export async function getUserFeed(viewerId: string, userId: string, tab: "posts" | "replies", take = 40): Promise<FeedItem[]> {
  const include = postInclude(viewerId);
  const posts = await prisma.post.findMany({
    where: { authorId: userId, parentId: tab === "replies" ? { not: null } : null },
    include,
    orderBy: { createdAt: "desc" },
    take,
  });
  if (tab === "replies") return merge(posts, [], take);
  const recasts = await prisma.recast.findMany({
    where: { userId },
    include: { user: { select: { name: true, handle: true } }, post: { include } },
    orderBy: { createdAt: "desc" },
    take,
  });
  return merge(posts, recasts, take);
}

export async function getOrgPosts(viewerId: string, orgId: string, take = 30): Promise<FeedItem[]> {
  const posts = await prisma.post.findMany({ where: { orgs: { some: { orgId } } }, include: postInclude(viewerId), orderBy: { createdAt: "desc" }, take });
  return merge(posts, [], take);
}
