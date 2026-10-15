import "server-only";
import { cache } from "react";
import type { Prisma } from "@prisma/client";
import { prisma } from "./db";

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

export async function getHomeFeed(viewerId: string, mode: "following" | "all", take = 40): Promise<FeedItem[]> {
  const include = postInclude(viewerId);
  if (mode === "all") {
    const posts = await prisma.post.findMany({ where: { parentId: null }, include, orderBy: { createdAt: "desc" }, take });
    return merge(posts, [], take);
  }
  const [follows, orgFollows, channels] = await Promise.all([
    prisma.followUser.findMany({ where: { followerId: viewerId }, select: { followeeId: true } }),
    prisma.followOrg.findMany({ where: { userId: viewerId }, select: { orgId: true } }),
    prisma.channelMember.findMany({ where: { userId: viewerId }, select: { channelId: true } }),
  ]);
  const authorIds = [viewerId, ...follows.map((f) => f.followeeId)];
  const posts = await prisma.post.findMany({
    where: {
      parentId: null,
      OR: [
        { authorId: { in: authorIds } },
        { orgs: { some: { orgId: { in: orgFollows.map((o) => o.orgId) } } } },
        { channelId: { in: channels.map((c) => c.channelId) } },
      ],
    },
    include,
    orderBy: { createdAt: "desc" },
    take,
  });
  const recasts = await prisma.recast.findMany({
    where: { userId: { in: follows.map((f) => f.followeeId) } },
    include: { user: { select: { name: true, handle: true } }, post: { include } },
    orderBy: { createdAt: "desc" },
    take,
  });
  return merge(posts, recasts, take);
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
