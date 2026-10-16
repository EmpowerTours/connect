import { Filter, Sparkles, Users } from "lucide-react";
import Link from "next/link";
import type { PostCtx } from "@/components/post-card";
import { UserAvatar } from "@/components/avatar";
import { avatarUrl } from "@/lib/media";
import { Composer } from "@/components/composer";
import { EmptyState } from "@/components/empty-state";
import { FeedPicker } from "@/components/feed-picker";
import { Columns, PageHeader, Tabs } from "@/components/layout";
import { PostCard } from "@/components/post-card";
import { getLocale, requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getProgrammableFeed, viewerMutes, type FeedViewer } from "@/lib/feed";
import { DEFAULT_FEED_ALGORITHM, resolveFeedAlgorithm, type FeedAlgorithm } from "@/lib/feed-algorithms";
import { t } from "@/lib/i18n";
import { getPostCtx } from "@/lib/post-ctx";

export const dynamic = "force-dynamic";

export default async function HomePage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const user = await requireUser();
  const locale = await getLocale();
  const tab = (await searchParams).tab === "all" ? "all" : "following";
  const ctx = await getPostCtx(user, locale);
  const algorithm = resolveFeedAlgorithm({ saved: user.feedAlgorithm });
  const mutes = viewerMutes(user);
  const channels = await prisma.channel.findMany({ select: { slug: true, name: true }, orderBy: { slug: "asc" } });
  const back = tab === "all" ? "/updates?tab=all" : "/updates";

  return (
    <Columns>
      <PageHeader title={t(locale, "nav.updates")} back="/more">
        <Tabs
          tabs={[
            { href: "/updates", label: t(locale, "home.following"), active: tab === "following" },
            { href: "/updates?tab=all", label: t(locale, "home.forYou"), active: tab === "all" },
          ]}
        />
      </PageHeader>
      <FeedPicker
        locale={locale}
        active={algorithm}
        mode={{ kind: "save", back }}
        mutes={{ topics: [...mutes.topics], channels: [...mutes.channels] }}
        channels={channels}
      />
      <div className="border-b border-line" id="compose">
        <Composer locale={locale} channels={ctx.channels} author={<UserAvatar name={user.name} seed={user.handle} src={avatarUrl(user.avatarKey)} size={42} />} />
      </div>
      {/* Rendered inline (no Suspense/loading.tsx): in Next 15.5 streamed boundaries here stopped server-action refreshes from applying. */}
      {await HomeFeed({ viewer: user, tab, ctx, algorithm })}
    </Columns>
  );
}

async function HomeFeed({ viewer, tab, ctx, algorithm }: { viewer: FeedViewer; tab: "following" | "all"; ctx: PostCtx; algorithm: FeedAlgorithm }) {
  const items = await getProgrammableFeed(viewer, { pool: tab, algorithm });
  const locale = ctx.locale;
  const filtered = algorithm.id !== DEFAULT_FEED_ALGORITHM || viewer.mutedTopics !== "[]" || viewer.mutedChannels !== "[]";
  if (items.length === 0 && filtered) {
    return <EmptyState icon={Filter} title={t(locale, "feed.emptyTitle")} body={t(locale, "feed.emptyBody")} />;
  }
  if (items.length === 0) {
    return (
      <EmptyState
        icon={tab === "following" ? Users : Sparkles}
        title={t(locale, "home.emptyTitle")}
        body={t(locale, "home.emptyBody")}
        action={
          <div className="flex flex-wrap justify-center gap-2">
            <Link href="/channels" className="btn-primary">{t(locale, "home.findChannels")}</Link>
            <Link href="/import" className="btn-secondary">{t(locale, "nav.import")}</Link>
          </div>
        }
      />
    );
  }
  return (
    <div className="animate-fade-in">
      {items.map((item) => (
        <PostCard key={item.key} item={item} ctx={ctx} />
      ))}
    </div>
  );
}
