import { notFound } from "next/navigation";
import { Hash, MessageSquarePlus } from "lucide-react";
import { toggleChannelAction } from "@/app/actions";
import { UserAvatar } from "@/components/avatar";
import { avatarUrl } from "@/lib/media";
import { Composer } from "@/components/composer";
import { EmptyState } from "@/components/empty-state";
import { Columns, PageHeader } from "@/components/layout";
import { PostCard } from "@/components/post-card";
import { getLocale, requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getChannelFeed } from "@/lib/feed";
import { t } from "@/lib/i18n";
import { getPostCtx } from "@/lib/post-ctx";

export const dynamic = "force-dynamic";

export default async function ChannelPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
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
  const [items, ctx] = await Promise.all([getChannelFeed(user.id, channel.id), getPostCtx(user, locale)]);

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
      <div className="hidden border-b border-line md:block">
        <Composer locale={locale} channels={ctx.channels} defaultChannel={channel.slug} author={<UserAvatar name={user.name} seed={user.handle} src={avatarUrl(user.avatarKey)} size={42} />} />
      </div>
      {items.length === 0 ? (
        <EmptyState icon={MessageSquarePlus} title={t(locale, "channels.emptyTitle")} body={t(locale, "channels.emptyBody")} />
      ) : (
        items.map((item) => <PostCard key={item.key} item={item} ctx={ctx} />)
      )}
    </Columns>
  );
}
