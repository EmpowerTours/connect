import Link from "next/link";
import { Hash } from "lucide-react";
import { toggleChannelAction } from "@/app/actions";
import { Columns, PageHeader } from "@/components/layout";
import { getLocale, requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { t } from "@/lib/i18n";
import { trendingScore } from "@/lib/posts";

export const dynamic = "force-dynamic";

export default async function ChannelsPage() {
  const user = await requireUser();
  const locale = await getLocale();
  const since = new Date(Date.now() - 14 * 86400_000);
  const channels = await prisma.channel.findMany({
    include: {
      _count: { select: { members: true, posts: true } },
      members: { where: { userId: user.id }, select: { userId: true } },
      posts: { where: { createdAt: { gte: since } }, select: { createdAt: true } },
    },
  });
  const sorted = channels
    .map((c) => ({ ...c, score: trendingScore(c.posts.map((p) => p.createdAt), c._count.members), joined: c.members.length > 0 }))
    .sort((a, b) => Number(b.joined) - Number(a.joined) || b.score - a.score);

  return (
    <Columns>
      <PageHeader title={t(locale, "nav.channels")} subtitle={t(locale, "channels.subtitle")} />
      <ul>
        {sorted.map((c) => (
          <li key={c.id} className="group relative flex items-center gap-4 border-b border-line px-4 py-4 transition hover:bg-black/[0.03]">
            <Link href={`/channels/${c.slug}`} className="absolute inset-0" aria-label={c.name} />
            <span className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-accent-soft text-accent">
              <Hash size={22} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="flex items-baseline gap-2">
                <span className="text-[16px] font-semibold">/{c.slug}</span>
                <span className="truncate text-sm text-faint">{c.name}</span>
              </p>
              <p className="line-clamp-1 text-sm text-muted">{c.description}</p>
              <p className="mt-0.5 text-xs text-faint">
                {c._count.members} {t(locale, "channels.members")} · {c._count.posts} {t(locale, "channels.casts")}
                {c.posts.length > 0 && <span className="text-accent"> · {c.posts.length} {t(locale, "rail.recentCasts")}</span>}
              </p>
            </div>
            <form action={toggleChannelAction} className="relative z-10">
              <input type="hidden" name="channelId" value={c.id} />
              <button className={c.joined ? "btn-secondary h-9 min-w-[84px]" : "btn-primary h-9 min-w-[84px]"}>
                {c.joined ? t(locale, "channels.joined") : t(locale, "channels.join")}
              </button>
            </form>
          </li>
        ))}
      </ul>
    </Columns>
  );
}
