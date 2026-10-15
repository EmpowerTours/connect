import Link from "next/link";
import { Building2, Hash, Search } from "lucide-react";
import { OrgLogo, UserAvatar } from "@/components/avatar";
import { DemoBadge } from "@/components/badges";
import { Columns, PageHeader } from "@/components/layout";
import { PostCard } from "@/components/post-card";
import { getLocale, requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { postInclude } from "@/lib/feed";
import { ORG_TYPE_LABELS, t } from "@/lib/i18n";
import { getPostCtx } from "@/lib/post-ctx";

export const dynamic = "force-dynamic";

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const user = await requireUser();
  const locale = await getLocale();
  const q = ((await searchParams).q ?? "").trim();
  const like = { contains: q };
  const [people, orgs, channels, posts, ctx] = await Promise.all([
    q ? prisma.user.findMany({ where: { OR: [{ name: like }, { handle: like }, { headline: like }, { orgName: like }] }, take: 8 }) : Promise.resolve([]),
    q
      ? prisma.organization.findMany({ where: { OR: [{ name: like }, { aliases: like }, { slug: like }] }, take: 8, orderBy: { name: "asc" } })
      : prisma.organization.findMany({ where: { followers: { some: {} } }, take: 6, orderBy: { name: "asc" } }),
    q ? prisma.channel.findMany({ where: { OR: [{ slug: like }, { name: like }, { description: like }] }, take: 5 }) : Promise.resolve([]),
    q ? prisma.post.findMany({ where: { body: like }, include: postInclude(user.id), orderBy: { createdAt: "desc" }, take: 10 }) : Promise.resolve([]),
    getPostCtx(user, locale),
  ]);
  const head = "px-4 pb-2 pt-5 text-[13px] font-semibold uppercase tracking-wide text-faint";

  return (
    <Columns>
      <PageHeader title={t(locale, "search.title")}>
        <form className="px-4 pb-3">
          <div className="relative">
            <Search size={17} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-faint" />
            <input name="q" defaultValue={q} autoFocus placeholder={t(locale, "search.placeholder")} className="input rounded-full bg-raised pl-11" />
          </div>
        </form>
      </PageHeader>
      {people.length > 0 && (
        <section>
          <h2 className={head}>{t(locale, "search.people")}</h2>
          {people.map((p) => (
            <Link key={p.id} href={`/u/${p.handle}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-black/[0.03]">
              <UserAvatar name={p.name} seed={p.handle} size={40} />
              <span className="min-w-0">
                <span className="flex items-center gap-1.5 font-semibold">{p.name} {p.isDemo && <DemoBadge locale={locale} />}</span>
                <span className="block truncate text-sm text-faint">@{p.handle} · {[p.headline, p.orgName].filter(Boolean).join(" @ ")}</span>
              </span>
            </Link>
          ))}
        </section>
      )}
      <section>
        <h2 className={`${head} flex items-center justify-between`}>
          {q ? t(locale, "search.orgs") : t(locale, "search.followedOrgs")}
          <Link href={q ? `/orgs?q=${encodeURIComponent(q)}` : "/orgs"} className="normal-case tracking-normal text-accent">{t(locale, "search.allOrgs")}</Link>
        </h2>
        {orgs.map((o) => (
          <Link key={o.id} href={`/orgs/${o.slug}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-black/[0.03]">
            <OrgLogo slug={o.slug} name={o.name} size={40} />
            <span className="min-w-0">
              <span className="block font-semibold">{o.name}</span>
              <span className="block text-sm text-faint">{ORG_TYPE_LABELS[locale][o.type]}{o.country && ` · ${o.country}`}</span>
            </span>
          </Link>
        ))}
        {orgs.length === 0 && (
          <Link href="/orgs" className="mx-4 flex items-center gap-2 rounded-2xl border border-line p-4 text-sm text-muted hover:text-fg">
            <Building2 size={16} /> {t(locale, "search.browseOrgs")}
          </Link>
        )}
      </section>
      {channels.length > 0 && (
        <section>
          <h2 className={head}>{t(locale, "nav.channels")}</h2>
          {channels.map((c) => (
            <Link key={c.id} href={`/channels/${c.slug}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-black/[0.03]">
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-accent-soft text-accent"><Hash size={18} /></span>
              <span><span className="block font-semibold">/{c.slug}</span><span className="block text-sm text-faint">{c.description}</span></span>
            </Link>
          ))}
        </section>
      )}
      {posts.length > 0 && (
        <section className="mt-2 border-t border-line">
          <h2 className={head}>{t(locale, "search.casts")}</h2>
          {posts.map((p) => <PostCard key={p.id} item={{ key: p.id, post: p, at: p.createdAt }} ctx={ctx} />)}
        </section>
      )}
      {q && !people.length && !orgs.length && !channels.length && !posts.length && <p className="px-4 py-10 text-center text-faint">{t(locale, "search.none")}</p>}
    </Columns>
  );
}
