import Link from "next/link";
import { notFound } from "next/navigation";
import { CalendarDays, Check, Handshake, KanbanSquare, MapPin, MessageSquareText, Sparkles, UserPlus } from "lucide-react";
import { toggleFollowUserAction } from "@/app/actions";
import { UserAvatar } from "@/components/avatar";
import { DemoBadge, ProofBadges, VerifiedTick } from "@/components/badges";
import { EmptyState } from "@/components/empty-state";
import { IntroModal } from "@/components/intro-modal";
import { Columns, PageHeader, Tabs } from "@/components/layout";
import { PostCard } from "@/components/post-card";
import { getLocale, requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getUserFeed } from "@/lib/feed";
import { t } from "@/lib/i18n";
import { getPostCtx } from "@/lib/post-ctx";
import { getGraph, getTrackRecord } from "@/lib/profile";

export const dynamic = "force-dynamic";

export default async function ProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ handle: string }>;
  searchParams: Promise<{ tab?: string; intro?: string; error?: string; saved?: string; via?: string }>;
}) {
  const { handle } = await params;
  const sp = await searchParams;
  const me = await requireUser();
  const locale = await getLocale();
  const user = await prisma.user.findUnique({
    where: { handle },
    include: { org: true, _count: { select: { followers: true, following: true, posts: true } } },
  });
  if (!user) notFound();
  const isMe = user.id === me.id;
  const tab = sp.tab === "replies" ? "replies" : sp.tab === "about" ? "about" : "posts";
  const [graph, record, ctx] = await Promise.all([getGraph(me.id, user.id), getTrackRecord(user.id), getPostCtx(me, locale)]);
  const mutualUsers = graph.mutualIds.length
    ? await prisma.user.findMany({ where: { id: { in: graph.mutualIds } }, select: { id: true, name: true, handle: true, isDemo: true, headline: true, orgName: true } })
    : [];
  const items = tab === "about" ? [] : await getUserFeed(me.id, user.id, tab);
  const verified = user.workEmailVerified || user.linkedinVerified || user.walletVerified;
  const canRequestIntro = !isMe && !graph.connected;
  const base = `/u/${user.handle}`;

  const stats = [
    { icon: KanbanSquare, value: record.dealsClosed, label: t(locale, "track.deals"), hint: t(locale, "track.dealsHint") },
    { icon: Handshake, value: record.introsMade, label: t(locale, "track.intros"), hint: t(locale, "track.introsHint") },
    { icon: Sparkles, value: record.helpfulPosts, label: t(locale, "track.helpful"), hint: t(locale, "track.helpfulHint") },
  ];

  return (
    <Columns>
      <PageHeader title={user.name} subtitle={`${user._count.posts} ${t(locale, "profile.casts")}`} back="/more" />
      <section className="border-b border-line">
        <div className="h-28 bg-[radial-gradient(120%_140%_at_0%_0%,rgb(124_92_255/0.55),transparent_55%),radial-gradient(120%_140%_at_100%_100%,rgb(124_92_255/0.25),transparent_60%)] sm:h-36" />
        <div className="px-4 pb-4">
          <div className="-mt-12 flex items-end justify-between gap-3 sm:-mt-14">
            <UserAvatar name={user.name} seed={user.handle} size={96} ring />
            <div className="flex flex-wrap justify-end gap-2 pb-1">
              {isMe ? (
                <Link href="/profile" className="btn-secondary">{t(locale, "profile.edit")}</Link>
              ) : (
                <>
                  {canRequestIntro && (
                    <Link href={`${base}?intro=1`} scroll={false} className="btn-secondary">
                      <Handshake size={16} /> {t(locale, "profile.requestIntro")}
                    </Link>
                  )}
                  <form action={toggleFollowUserAction}>
                    <input type="hidden" name="userId" value={user.id} />
                    <button className={graph.viewerFollows ? "btn-secondary min-w-[104px]" : "btn-primary min-w-[104px]"}>
                      {graph.viewerFollows ? <><Check size={16} /> {graph.connected ? t(locale, "profile.connected") : t(locale, "profile.unfollow")}</> : <><UserPlus size={16} /> {graph.followsViewer ? t(locale, "profile.followBack") : t(locale, "profile.follow")}</>}
                    </button>
                  </form>
                </>
              )}
            </div>
          </div>

          <div className="mt-3">
            <h2 className="flex flex-wrap items-center gap-2 text-[22px] font-bold leading-tight tracking-tight">
              {user.name} <VerifiedTick verified={verified} /> {user.isDemo && <DemoBadge locale={locale} />}
            </h2>
            <p className="text-[15px] text-faint">@{user.handle}</p>
            {(user.headline || user.orgName) && (
              <p className="mt-2 text-[16px] font-medium">
                {user.headline}
                {user.orgName && (
                  <>
                    {" @ "}
                    {user.org ? <Link href={`/orgs/${user.org.slug}`} className="text-accent hover:underline">{user.org.name}</Link> : <span>{user.orgName}</span>}
                  </>
                )}
              </p>
            )}
            {user.bio && <p className="mt-2 whitespace-pre-wrap text-[15px] leading-relaxed text-fg/90">{user.bio}</p>}
            {user.isDemo && <p className="mt-2 text-xs text-amber-800">{t(locale, "demo.profileNote")}</p>}
            <p className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-sm text-faint">
              {user.location && <span className="inline-flex items-center gap-1"><MapPin size={14} />{user.location}</span>}
              <span className="inline-flex items-center gap-1"><CalendarDays size={14} />{t(locale, "profile.joined")} {user.createdAt.toLocaleDateString(locale === "es" ? "es-MX" : "en-US", { month: "long", year: "numeric" })}</span>
            </p>
            <p className="mt-2.5 flex flex-wrap gap-x-4 text-[15px]">
              <span><b>{graph.connectionCount}</b> <span className="text-faint">{t(locale, "profile.connections")}</span></span>
              <span><b>{user._count.followers}</b> <span className="text-faint">{t(locale, "profile.followers")}</span></span>
              <span><b>{user._count.following}</b> <span className="text-faint">{t(locale, "profile.followingCount")}</span></span>
            </p>
            {!isMe && mutualUsers.length > 0 && (
              <div className="mt-3 flex items-center gap-2">
                <span className="flex -space-x-2">
                  {mutualUsers.slice(0, 3).map((m) => <UserAvatar key={m.id} name={m.name} seed={m.handle} size={24} ring />)}
                </span>
                <p className="text-[13px] text-faint">
                  {t(locale, "profile.mutualWith")} {mutualUsers.slice(0, 2).map((m) => m.name.split(" ")[0]).join(", ")}
                  {mutualUsers.length > 2 ? ` +${mutualUsers.length - 2}` : ""}
                </p>
              </div>
            )}
            <div className="mt-4">
              <ProofBadges user={user} locale={locale} />
            </div>
          </div>

          <div className="mt-4 rounded-2xl border border-line bg-raised/50 p-4">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-[15px] font-bold">{t(locale, "track.title")}</h3>
              <span className="chip border-accent/40 text-violet-200">{t(locale, `tier.${record.tier}`)} · {record.score}</span>
            </div>
            <ul className="grid grid-cols-3 gap-2">
              {stats.map(({ icon: Icon, value, label, hint }) => (
                <li key={label} title={hint} className="rounded-xl border border-line bg-surface p-3">
                  <Icon size={16} className="text-accent" />
                  <p className="mt-2 text-2xl font-bold tabular-nums">{value}</p>
                  <p className="text-xs leading-tight text-faint">{label}</p>
                </li>
              ))}
            </ul>
            <p className="mt-2.5 text-xs text-faint">{t(locale, "track.note")}</p>
          </div>
        </div>
        <Tabs
          tabs={[
            { href: base, label: t(locale, "profile.tabPosts"), active: tab === "posts" },
            { href: `${base}?tab=replies`, label: t(locale, "profile.tabReplies"), active: tab === "replies" },
            { href: `${base}?tab=about`, label: t(locale, "profile.tabAbout"), active: tab === "about" },
          ]}
        />
      </section>

      {tab === "about" ? (
        <div className="space-y-4 px-4 py-5 text-[15px]">
          <div>
            <h3 className="label">{t(locale, "profile.role")}</h3>
            <p>{[user.headline || user.role, user.orgName].filter(Boolean).join(" @ ") || "—"}</p>
          </div>
          <div>
            <h3 className="label">{t(locale, "profile.bio")}</h3>
            <p className="whitespace-pre-wrap text-fg/90">{user.bio || "—"}</p>
          </div>
          {!isMe && (
            <div>
              <h3 className="label">{t(locale, "profile.mutualConnections")}</h3>
              {mutualUsers.length ? (
                <ul className="space-y-2">
                  {mutualUsers.map((m) => (
                    <li key={m.id}>
                      <Link href={`/u/${m.handle}`} className="flex items-center gap-2.5">
                        <UserAvatar name={m.name} seed={m.handle} size={32} />
                        <span className="font-medium">{m.name}</span>
                        <span className="truncate text-sm text-faint">{[m.headline, m.orgName].filter(Boolean).join(" @ ")}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-faint">{t(locale, "profile.noMutual")}</p>
              )}
            </div>
          )}
        </div>
      ) : items.length === 0 ? (
        <EmptyState icon={MessageSquareText} title={t(locale, "profile.noPosts")} />
      ) : (
        items.map((item) => <PostCard key={item.key} item={item} ctx={ctx} />)
      )}

      {sp.intro && canRequestIntro && <IntroModal me={me} target={user} mutual={mutualUsers} introParam={sp.intro} error={sp.error} locale={locale} via={sp.via} />}
    </Columns>
  );
}
