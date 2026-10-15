import Link from "next/link";
import { addSignalAction, ingestNowAction, toggleFollowUserAction } from "@/app/actions";
import { PostComposer } from "@/components/post-composer";
import { SubmitButton } from "@/components/submit-button";
import { Avatar, OrgChip, Section, VerifiedBadge, timeAgo } from "@/components/ui";
import { getLocale, requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { t } from "@/lib/i18n";

export const dynamic = "force-dynamic";

export default async function FeedPage({ searchParams }: { searchParams: Promise<{ tab?: string; scope?: string; untagged?: string }> }) {
  const user = await requireUser();
  const locale = await getLocale();
  const sp = await searchParams;
  const tab = sp.tab === "posts" ? "posts" : "signals";
  const scope = sp.scope === "following" ? "following" : "all";
  const showUntagged = sp.untagged === "1";

  const [followedOrgs, followedUsers] = await Promise.all([
    prisma.followOrg.findMany({ where: { userId: user.id }, select: { orgId: true } }),
    prisma.followUser.findMany({ where: { followerId: user.id }, select: { followeeId: true } }),
  ]);
  const orgIds = followedOrgs.map((f) => f.orgId);
  const userIds = [user.id, ...followedUsers.map((f) => f.followeeId)];

  const posts =
    tab === "posts"
      ? await prisma.post.findMany({
          where: scope === "following" ? { OR: [{ authorId: { in: userIds } }, { orgs: { some: { orgId: { in: orgIds } } } }] } : {},
          include: { author: true, orgs: { include: { org: { select: { slug: true, name: true } } } } },
          orderBy: { createdAt: "desc" },
          take: 50,
        })
      : [];
  const signals =
    tab === "signals"
      ? await prisma.signal.findMany({
          where:
            scope === "following"
              ? { orgs: { some: { orgId: { in: orgIds } } } }
              : showUntagged
                ? {}
                : { orgs: { some: {} } },
          include: { orgs: { include: { org: { select: { slug: true, name: true } } } } },
          orderBy: { publishedAt: "desc" },
          take: 60,
        })
      : [];
  const feeds = await prisma.rssFeed.findMany({ orderBy: { name: "asc" } });
  const followingIds = new Set(followedUsers.map((f) => f.followeeId));

  const tabLink = (next: Record<string, string>) => {
    const q = new URLSearchParams({ tab, scope, ...(showUntagged ? { untagged: "1" } : {}), ...next });
    return `/feed?${q.toString()}`;
  };
  const pill = (active: boolean) => `rounded-lg px-3 py-1.5 text-sm ${active ? "bg-white/10 text-white" : "text-zinc-400 hover:text-white"}`;

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
      <div className="min-w-0 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">{t(locale, "feed.title")}</h1>
          <div className="flex gap-1">
            <Link href={tabLink({ scope: "all" })} className={pill(scope === "all")}>{t(locale, "feed.all")}</Link>
            <Link href={tabLink({ scope: "following" })} className={pill(scope === "following")}>{t(locale, "feed.following")}</Link>
          </div>
        </div>
        <div className="flex gap-1 border-b border-line">
          {(["signals", "posts"] as const).map((k) => (
            <Link
              key={k}
              href={tabLink({ tab: k })}
              className={`-mb-px border-b-2 px-4 py-2 text-sm ${tab === k ? "border-accent text-white" : "border-transparent text-zinc-400 hover:text-white"}`}
            >
              {t(locale, `feed.${k}`)}
            </Link>
          ))}
        </div>

        {tab === "posts" && (
          <>
            <PostComposer placeholder={t(locale, "feed.compose")} cta={t(locale, "feed.post")} />
            <ul className="space-y-3">
              {posts.map((p) => (
                <li key={p.id} className="card flex gap-3 p-4">
                  <Avatar name={p.author.name} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                      <Link href={`/u/${p.author.handle}`} className="font-semibold hover:text-violet-300">{p.author.name}</Link>
                      <VerifiedBadge verified={p.author.verified} locale={locale} />
                      <span className="text-zinc-500">@{p.author.handle}</span>
                      {p.author.role && <span className="text-zinc-500">· {p.author.role}{p.author.orgName ? ` @ ${p.author.orgName}` : ""}</span>}
                      <span className="text-xs text-zinc-600">· {timeAgo(p.createdAt, locale)}</span>
                      {p.authorId !== user.id && (
                        <form action={toggleFollowUserAction} className="ml-auto">
                          <input type="hidden" name="userId" value={p.authorId} />
                          <button className="chip hover:border-zinc-400">
                            {followingIds.has(p.authorId) ? `✓ ${t(locale, "profile.unfollow")}` : `+ ${t(locale, "profile.follow")}`}
                          </button>
                        </form>
                      )}
                    </div>
                    <p className="mt-1 whitespace-pre-wrap text-[15px] text-zinc-200">{p.body}</p>
                    {p.orgs.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {p.orgs.map(({ org }) => <OrgChip key={org.slug} slug={org.slug} name={org.name} />)}
                      </div>
                    )}
                  </div>
                </li>
              ))}
              {posts.length === 0 && <li className="text-sm text-zinc-500">{t(locale, "feed.empty")}</li>}
            </ul>
          </>
        )}

        {tab === "signals" && (
          <>
            <p className="flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-500">
              {scope === "all" && !showUntagged && <span>{t(locale, "feed.untagged")}</span>}
              {scope === "all" && (
                <Link href={tabLink({ untagged: showUntagged ? "0" : "1" })} className="text-violet-300">
                  {showUntagged ? "✓ " : ""}{t(locale, "feed.showAll")}
                </Link>
              )}
            </p>
            <ul className="space-y-2">
              {signals.map((s) => (
                <li key={s.id} className="card p-3">
                  <div className="mb-1 flex items-center gap-2 text-xs text-zinc-500">
                    <span className={`chip ${s.source === "manual" ? "border-violet-500/40 text-violet-300" : ""}`}>{s.source === "rss" ? s.sourceName : `✎ ${s.sourceName}`}</span>
                    <span>{timeAgo(s.publishedAt, locale)}</span>
                  </div>
                  {s.url ? (
                    <a href={s.url} target="_blank" rel="noreferrer" className="font-medium hover:text-violet-300">{s.title}</a>
                  ) : (
                    <p className="font-medium">{s.title}</p>
                  )}
                  {s.summary && <p className="mt-1 line-clamp-2 text-sm text-zinc-400">{s.summary}</p>}
                  {s.orgs.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {s.orgs.map(({ org }) => <OrgChip key={org.slug} slug={org.slug} name={org.name} />)}
                    </div>
                  )}
                </li>
              ))}
              {signals.length === 0 && <li className="text-sm text-zinc-500">{t(locale, "feed.empty")}</li>}
            </ul>
          </>
        )}
      </div>

      <aside className="space-y-4">
        <Section title={t(locale, "feed.sources")}>
          <form action={ingestNowAction} className="mb-3">
            <SubmitButton className="btn-ghost w-full">⟳ {t(locale, "feed.refresh")}</SubmitButton>
          </form>
          <ul className="space-y-1.5 text-xs">
            {feeds.map((f) => (
              <li key={f.id} className="flex justify-between gap-2">
                <span className="text-zinc-300">{f.name}</span>
                <span className={f.lastError ? "text-rose-300" : "text-zinc-500"}>
                  {f.lastError ? f.lastError : f.lastFetchedAt ? timeAgo(f.lastFetchedAt, locale) : "—"}
                </span>
              </li>
            ))}
          </ul>
        </Section>
        <Section title={t(locale, "feed.addSignal")}>
          <form action={addSignalAction} className="space-y-2">
            <input name="title" required placeholder={t(locale, "feed.signalTitle")} className="input" />
            <input name="url" type="url" placeholder={t(locale, "feed.signalUrl")} className="input" />
            <textarea name="summary" rows={2} placeholder={t(locale, "feed.signalSummary")} className="input" />
            <SubmitButton className="btn-ghost w-full">{t(locale, "feed.add")}</SubmitButton>
          </form>
        </Section>
      </aside>
    </div>
  );
}
