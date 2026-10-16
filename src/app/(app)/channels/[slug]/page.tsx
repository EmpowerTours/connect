import { notFound } from "next/navigation";
import { Filter, Hash, MessageSquarePlus } from "lucide-react";
import { setChannelDefaultFeedAction } from "@/app/feed-actions";
import { FeedPicker } from "@/components/feed-picker";
import { toggleChannelAction } from "@/app/actions";
import { UserAvatar } from "@/components/avatar";
import { avatarUrl } from "@/lib/media";
import { Composer } from "@/components/composer";
import { EmptyState } from "@/components/empty-state";
import { Columns, PageHeader } from "@/components/layout";
import { PostCard } from "@/components/post-card";
import { currentUserIsAdmin, getLocale, requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getProgrammableFeed, viewerMutes } from "@/lib/feed";
import { DEFAULT_FEED_ALGORITHM, listFeedAlgorithms, resolveFeedAlgorithm } from "@/lib/feed-algorithms";
import { t } from "@/lib/i18n";
import { getPostCtx } from "@/lib/post-ctx";

export const dynamic = "force-dynamic";

export default async function ChannelPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ feed?: string }> }) {
  const { slug } = await params;
  const { feed } = await searchParams;
  const user = await requireUser();
  const locale = await getLocale();
  const channel = await prisma.channel.findUnique({
    where: { slug },
    include: {
      _count: { select: { members: true } },
      members: { take: 6, orderBy: { createdAt: "asc" }, include: { user: { select: { id: true, name: true, handle: true } } } },
    },
  });
  if (!channel) notFound();
  const joined = !!(await prisma.channelMember.findUnique({ where: { userId_channelId: { userId: user.id, channelId: channel.id } } }));
  // The member's explicit pick (?feed=) wins; otherwise the channel decides what it rewards.
  const algorithm = resolveFeedAlgorithm({ requested: feed, channelDefault: channel.defaultFeed, saved: user.feedAlgorithm });
  const mutes = viewerMutes(user);
  const [items, ctx, isAdmin, allChannels] = await Promise.all([
    getProgrammableFeed(user, { pool: { channelId: channel.id }, algorithm }),
    getPostCtx(user, locale),
    currentUserIsAdmin(),
    prisma.channel.findMany({ select: { slug: true, name: true }, orderBy: { slug: "asc" } }),
  ]);

  return (
    <Columns>
      <PageHeader title={`/${channel.slug}`} subtitle={`${channel._count.members} ${t(locale, "channels.members")}`} back="/channels" />
      <section className="border-b border-line px-4 py-5">
        <div className="flex items-start gap-4">
          <span className="inline-flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-accent-soft text-accent">
            <Hash size={30} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-xl font-bold tracking-tight">{channel.name}</h2>
            <p className="mt-1 text-[15px] text-muted">{channel.description}</p>
            <div className="mt-3 flex items-center gap-2">
              <span className="flex -space-x-2">
                {channel.members.map((m) => (
                  <UserAvatar key={m.user.id} name={m.user.name} seed={m.user.handle} size={24} ring />
                ))}
              </span>
              <span className="text-xs text-faint">{channel._count.members} {t(locale, "channels.members")}</span>
            </div>
          </div>
          <form action={toggleChannelAction}>
            <input type="hidden" name="channelId" value={channel.id} />
            <button className={joined ? "btn-secondary" : "btn-primary"}>{joined ? t(locale, "channels.leave") : t(locale, "channels.join")}</button>
          </form>
        </div>
      </section>
      <FeedPicker
        locale={locale}
        active={algorithm}
        mode={{ kind: "link", base: `/channels/${channel.slug}` }}
        channelDefault={channel.defaultFeed || DEFAULT_FEED_ALGORITHM}
        mutes={{ topics: [...mutes.topics], channels: [...mutes.channels] }}
        channels={allChannels}
      />
      {isAdmin && (
        <form action={setChannelDefaultFeedAction} className="flex items-center gap-2 border-b border-line bg-accent-soft/40 px-4 py-2.5 text-[13px]">
          <input type="hidden" name="channelId" value={channel.id} />
          <label htmlFor="channel-default-feed" className="min-w-0 flex-1 text-muted">{t(locale, "feed.adminDefault")}</label>
          <select id="channel-default-feed" name="algorithm" defaultValue={channel.defaultFeed || DEFAULT_FEED_ALGORITHM} className="input h-9 w-auto py-1 text-[13px]">
            {listFeedAlgorithms().map((a) => (
              <option key={a.id} value={a.id}>{a.label[locale]}</option>
            ))}
          </select>
          <button className="btn-secondary h-9 text-[13px]">{t(locale, "feed.setDefault")}</button>
        </form>
      )}
      <div className="hidden border-b border-line md:block">
        <Composer locale={locale} channels={ctx.channels} defaultChannel={channel.slug} author={<UserAvatar name={user.name} seed={user.handle} src={avatarUrl(user.avatarKey)} size={42} />} />
      </div>
      {items.length === 0 && algorithm.id !== DEFAULT_FEED_ALGORITHM ? (
        <EmptyState icon={Filter} title={t(locale, "feed.emptyTitle")} body={t(locale, "feed.emptyBody")} />
      ) : items.length === 0 ? (
        <EmptyState icon={MessageSquarePlus} title={t(locale, "channels.emptyTitle")} body={t(locale, "channels.emptyBody")} />
      ) : (
        items.map((item) => <PostCard key={item.key} item={item} ctx={ctx} />)
      )}
    </Columns>
  );
}
