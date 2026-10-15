import { Sparkles, Users } from "lucide-react";
import Link from "next/link";
import type { PostCtx } from "@/components/post-card";
import { UserAvatar } from "@/components/avatar";
import { avatarUrl } from "@/lib/media";
import { Composer } from "@/components/composer";
import { EmptyState } from "@/components/empty-state";
import { Columns, PageHeader, Tabs } from "@/components/layout";
import { PostCard } from "@/components/post-card";
import { getLocale, requireUser } from "@/lib/auth";
import { getHomeFeed } from "@/lib/feed";
import { t } from "@/lib/i18n";
import { getPostCtx } from "@/lib/post-ctx";

export const dynamic = "force-dynamic";

export default async function HomePage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const user = await requireUser();
  const locale = await getLocale();
  const tab = (await searchParams).tab === "all" ? "all" : "following";
  const ctx = await getPostCtx(user, locale);

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
      <div className="border-b border-line" id="compose">
        <Composer locale={locale} channels={ctx.channels} author={<UserAvatar name={user.name} seed={user.handle} src={avatarUrl(user.avatarKey)} size={42} />} />
      </div>
      {/* Rendered inline (no Suspense/loading.tsx): in Next 15.5 streamed boundaries here stopped server-action refreshes from applying. */}
      {await HomeFeed({ viewerId: user.id, tab, ctx })}
    </Columns>
  );
}

async function HomeFeed({ viewerId, tab, ctx }: { viewerId: string; tab: "following" | "all"; ctx: PostCtx }) {
  const items = await getHomeFeed(viewerId, tab);
  const locale = ctx.locale;
  if (items.length === 0) {
    return (
      <EmptyState
        icon={tab === "following" ? Users : Sparkles}
        title={t(locale, "home.emptyTitle")}
        body={t(locale, "home.emptyBody")}
        action={<Link href="/channels" className="btn-primary">{t(locale, "home.findChannels")}</Link>}
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
