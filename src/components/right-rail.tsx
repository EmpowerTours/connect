import Link from "next/link";
import { Hash, Search } from "lucide-react";
import { toggleFollowUserAction } from "@/app/actions";
import { prisma } from "@/lib/db";
import { t, type Locale } from "@/lib/i18n";
import { connectionsOf, mutualConnections } from "@/lib/intros";
import { trendingScore } from "@/lib/posts";
import { OrgLogo, UserAvatar } from "./avatar";
import { DemoBadge } from "./badges";
import { RailCard } from "./layout";
import { timeAgo } from "./time";

export async function getTrendingChannels(limit = 5) {
  const since = new Date(Date.now() - 14 * 86400_000);
  const channels = await prisma.channel.findMany({
    include: { _count: { select: { members: true } }, posts: { where: { createdAt: { gte: since } }, select: { createdAt: true } } },
  });
  return channels
    .map((c) => ({ slug: c.slug, name: c.name, members: c._count.members, recent: c.posts.length, score: trendingScore(c.posts.map((p) => p.createdAt), c._count.members) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

export async function getSuggestedPeople(viewerId: string, limit = 3) {
  const edges = await prisma.followUser.findMany({ select: { followerId: true, followeeId: true } });
  const following = new Set(edges.filter((e) => e.followerId === viewerId).map((e) => e.followeeId));
  const users = await prisma.user.findMany({
    where: { id: { not: viewerId } },
    select: { id: true, name: true, handle: true, headline: true, orgName: true, isDemo: true },
  });
  const mine = connectionsOf(edges, viewerId);
  return users
    .filter((u) => !following.has(u.id))
    .map((u) => ({ ...u, mutual: mutualConnections(edges, viewerId, u.id).length, inNetwork: mine.size > 0 }))
    .sort((a, b) => b.mutual - a.mutual || a.name.localeCompare(b.name))
    .slice(0, limit);
}

export async function RightRail({ viewerId, locale }: { viewerId: string; locale: Locale }) {
  const [channels, people, signals] = await Promise.all([
    getTrendingChannels(),
    getSuggestedPeople(viewerId),
    prisma.signal.findMany({
      where: { orgs: { some: {} } },
      include: { orgs: { include: { org: { select: { slug: true, name: true } } }, take: 1 } },
      orderBy: { publishedAt: "desc" },
      take: 4,
    }),
  ]);
  return (
    <div className="space-y-4">
      <form action="/search" className="relative">
        <Search size={17} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-faint" />
        <input name="q" placeholder={t(locale, "search.placeholder")} className="input rounded-full bg-raised pl-11" />
      </form>

      <RailCard title={t(locale, "rail.trending")} footer={<Link href="/channels">{t(locale, "rail.allChannels")}</Link>}>
        <ul className="py-1">
          {channels.map((c, i) => (
            <li key={c.slug}>
              <Link href={`/channels/${c.slug}`} className="flex items-center gap-3 px-4 py-2.5 transition hover:bg-white/[0.03]">
                <span className="w-4 text-sm tabular-nums text-faint">{i + 1}</span>
                <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-accent-soft text-accent">
                  <Hash size={17} />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-[15px] font-semibold">/{c.slug}</span>
                  <span className="block text-xs text-faint">
                    {c.members} {t(locale, "channels.members")} · {c.recent} {t(locale, "rail.recentCasts")}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </RailCard>

      {people.length > 0 && (
        <RailCard title={t(locale, "rail.people")}>
          <ul className="py-1">
            {people.map((p) => (
              <li key={p.id} className="flex items-center gap-3 px-4 py-2.5">
                <Link href={`/u/${p.handle}`}>
                  <UserAvatar name={p.name} seed={p.handle} size={40} />
                </Link>
                <div className="min-w-0 flex-1">
                  <Link href={`/u/${p.handle}`} className="flex items-center gap-1.5 text-[15px] font-semibold hover:underline">
                    <span className="truncate">{p.name}</span>
                    {p.isDemo && <DemoBadge locale={locale} />}
                  </Link>
                  <p className="truncate text-xs text-faint">
                    {p.mutual > 0 ? `${p.mutual} ${t(locale, "profile.mutual")}` : [p.headline, p.orgName].filter(Boolean).join(" @ ")}
                  </p>
                </div>
                <form action={toggleFollowUserAction}>
                  <input type="hidden" name="userId" value={p.id} />
                  <button className="btn-secondary h-8 px-3.5 text-[13px]">{t(locale, "profile.follow")}</button>
                </form>
              </li>
            ))}
          </ul>
        </RailCard>
      )}

      <RailCard title={t(locale, "rail.signals")} footer={<Link href="/signals">{t(locale, "rail.allSignals")}</Link>}>
        <ul className="py-1">
          {signals.map((s) => {
            const org = s.orgs[0]?.org;
            return (
              <li key={s.id}>
                <a href={s.url ?? "#"} target="_blank" rel="noreferrer" className="flex gap-3 px-4 py-2.5 transition hover:bg-white/[0.03]">
                  {org && <OrgLogo slug={org.slug} name={org.name} size={28} />}
                  <span className="min-w-0">
                    <span className="block text-xs text-faint">
                      {s.sourceName} · {timeAgo(s.publishedAt, locale)}
                    </span>
                    <span className="line-clamp-2 text-[14px] font-medium leading-snug">{s.title}</span>
                  </span>
                </a>
              </li>
            );
          })}
          {signals.length === 0 && <li className="px-4 py-3 text-sm text-faint">{t(locale, "rail.noSignals")}</li>}
        </ul>
      </RailCard>
      <p className="px-4 text-xs leading-relaxed text-faint">{t(locale, "rail.footer")}</p>
    </div>
  );
}
