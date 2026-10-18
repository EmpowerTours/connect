import "server-only";
import { prisma } from "./db";
import { CURATED_PACKS, PACK_PEOPLE_MAX, type CuratedPack } from "./curated-packs";

/** How far back channel activity counts when picking a pack's people. */
const ACTIVE_WINDOW_MS = 60 * 86_400_000;

export interface PackPreview {
  pack: CuratedPack;
  orgs: { id: string; slug: string; name: string }[];
  channels: { id: string; slug: string; name: string }[];
  people: { id: string; name: string; handle: string; avatarKey: string | null }[];
}

/**
 * Resolves packs against the database: organizations and channels that exist, plus up to
 * PACK_PEOPLE_MAX people (members with an approved claim at a pack organization first, then the
 * most active posters in its channels). Never includes `viewerId`, and only onboarded or demo
 * profiles, so half-finished accounts are not suggested.
 */
export async function loadPackPreviews(viewerId: string, packs: readonly CuratedPack[] = CURATED_PACKS): Promise<PackPreview[]> {
  const orgSlugs = [...new Set(packs.flatMap((p) => p.orgs))];
  const channelSlugs = [...new Set(packs.flatMap((p) => p.channels))];
  const [orgs, channels] = await Promise.all([
    prisma.organization.findMany({ where: { slug: { in: orgSlugs } }, select: { id: true, slug: true, name: true } }),
    prisma.channel.findMany({ where: { slug: { in: channelSlugs } }, select: { id: true, slug: true, name: true } }),
  ]);
  const orgBySlug = new Map(orgs.map((o) => [o.slug, o]));
  const channelBySlug = new Map(channels.map((c) => [c.slug, c]));
  const eligible = { id: { not: viewerId }, OR: [{ onboardedAt: { not: null } }, { isDemo: true }] };
  const person = { id: true, name: true, handle: true, avatarKey: true } as const;
  const since = new Date(Date.now() - ACTIVE_WINDOW_MS);

  return Promise.all(
    packs.map(async (pack) => {
      const packOrgs = pack.orgs.map((s) => orgBySlug.get(s)).filter((o): o is NonNullable<typeof o> => !!o);
      const packChannels = pack.channels.map((s) => channelBySlug.get(s)).filter((c): c is NonNullable<typeof c> => !!c);
      const verified = await prisma.user.findMany({
        where: { ...eligible, orgClaims: { some: { status: "approved", orgId: { in: packOrgs.map((o) => o.id) } } } },
        select: person,
        take: PACK_PEOPLE_MAX,
      });
      const active = verified.length >= PACK_PEOPLE_MAX ? [] : await prisma.post.groupBy({
        by: ["authorId"],
        where: { channelId: { in: packChannels.map((c) => c.id) }, createdAt: { gte: since }, authorId: { notIn: [viewerId, ...verified.map((v) => v.id)] } },
        _count: { _all: true },
        orderBy: { _count: { authorId: "desc" } },
        take: PACK_PEOPLE_MAX,
      });
      const posters = active.length
        ? await prisma.user.findMany({ where: { ...eligible, id: { in: active.map((a) => a.authorId) } }, select: person })
        : [];
      const rank = new Map(active.map((a, i) => [a.authorId, i]));
      posters.sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0));
      return { pack, orgs: packOrgs, channels: packChannels, people: [...verified, ...posters].slice(0, PACK_PEOPLE_MAX) };
    }),
  );
}

/** Follows every organization and person and joins every channel in the chosen packs. Idempotent. */
export async function applyPacks(userId: string, packIds: string[]): Promise<{ orgs: number; channels: number; people: number }> {
  const packs = CURATED_PACKS.filter((p) => packIds.includes(p.id));
  if (!packs.length) return { orgs: 0, channels: 0, people: 0 };
  const previews = await loadPackPreviews(userId, packs);
  const orgIds = [...new Set(previews.flatMap((p) => p.orgs.map((o) => o.id)))];
  const channelIds = [...new Set(previews.flatMap((p) => p.channels.map((c) => c.id)))];
  const peopleIds = [...new Set(previews.flatMap((p) => p.people.map((u) => u.id)))].filter((id) => id !== userId);
  await prisma.$transaction([
    prisma.followOrg.createMany({ data: orgIds.map((orgId) => ({ userId, orgId })), skipDuplicates: true }),
    prisma.channelMember.createMany({ data: channelIds.map((channelId) => ({ userId, channelId })), skipDuplicates: true }),
    prisma.followUser.createMany({ data: peopleIds.map((followeeId) => ({ followerId: userId, followeeId })), skipDuplicates: true }),
  ]);
  return { orgs: orgIds.length, channels: channelIds.length, people: peopleIds.length };
}
