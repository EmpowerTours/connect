import "server-only";
import { cache } from "react";
import { prisma } from "./db";
import { publicUserSelect } from "./public-fields";

/**
 * Lookups shared by the public profile/post pages, their metadata and their preview images
 * (cached per request). Only fields that a signed-out visitor may see are selected
 * (src/lib/public-fields.ts); the pages load anything viewer-specific separately, for members.
 */
export const getPublicUser = cache((handle: string) => prisma.user.findUnique({ where: { handle }, select: publicUserSelect }));

export const getPublicPost = cache((id: string) =>
  prisma.post.findUnique({
    where: { id },
    select: {
      id: true,
      body: true,
      createdAt: true,
      parentId: true,
      author: { select: { name: true, handle: true, headline: true, orgName: true, isDemo: true, onboardedAt: true } },
      _count: { select: { likes: true, replies: true, recasts: true } },
    },
  }),
);
