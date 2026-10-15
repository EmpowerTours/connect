import Link from "next/link";
import { notFound } from "next/navigation";
import { BadgeCheck, ExternalLink, Lock, MapPin, Newspaper, Plus, ShieldQuestion, Users } from "lucide-react";
import { addToPipelineAction, toggleFollowOrgAction } from "@/app/actions";
import { OrgLogo, UserAvatar } from "@/components/avatar";
import { ClaimPanel } from "@/components/claim-panel";
import { DemoBadge } from "@/components/badges";
import { OrgFacts, PrivateDealPanel } from "@/components/deal-panel";
import { EmptyState } from "@/components/empty-state";
import { Columns, PageHeader, Tabs } from "@/components/layout";
import { PostCard } from "@/components/post-card";
import { SubmitButton } from "@/components/submit-button";
import { timeAgo } from "@/components/time";
import { getLocale, getWorkspace, requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getOrgPosts } from "@/lib/feed";
import { ORG_TYPE_LABELS, REGION_LABELS, t } from "@/lib/i18n";
import { parseList } from "@/lib/json";
import { isStage } from "@/lib/pipeline";
import { getPostCtx } from "@/lib/post-ctx";
import { getScoutProvider } from "@/lib/scout";

export const dynamic = "force-dynamic";

export default async function OrgPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ tab?: string; scoutError?: string; claim?: string; claimError?: string }>;
}) {
  const { slug } = await params;
  const sp = await searchParams;
  const user = await requireUser();
  const locale = await getLocale();
  const ws = await getWorkspace(user.id);
  const org = await prisma.organization.findUnique({
    where: { slug },
    include: {
      followers: { where: { userId: user.id } },
      claims: {
        where: { status: "approved" },
        include: { user: { select: { id: true, name: true, handle: true, headline: true, isDemo: true, walletVerified: true, walletAddress: true } } },
        orderBy: { decidedAt: "asc" },
      },
      _count: { select: { followers: true, posts: true, signals: true } },
    },
  });
  if (!org) notFound();
  const myClaim = await prisma.orgClaim.findUnique({ where: { userId_orgId: { userId: user.id, orgId: org.id } } });
  const verifiedMembers = org.claims;
  const deal = await prisma.deal.findUnique({
    where: { workspaceId_orgId: { workspaceId: ws.id, orgId: org.id } },
    include: {
      contacts: { orderBy: [{ isChampion: "desc" }, { createdAt: "asc" }] },
      advisors: { include: { advisorOrg: true }, orderBy: { createdAt: "asc" } },
      activities: { include: { user: true }, orderBy: { createdAt: "desc" }, take: 30 },
    },
  });
  const tabs = ["posts", "people", "news", "about", "deal"] as const;
  const tab = (tabs as readonly string[]).includes(sp.tab ?? "") ? (sp.tab as (typeof tabs)[number]) : "posts";
  const base = `/orgs/${org.slug}`;
  const following = org.followers.length > 0;
  const chains = parseList(org.chainsInUse);

  const [items, ctx, signals, drafts] = await Promise.all([
    tab === "posts" ? getOrgPosts(user.id, org.id) : Promise.resolve([]),
    getPostCtx(user, locale),
    tab === "news" ? prisma.signal.findMany({ where: { orgs: { some: { orgId: org.id } } }, orderBy: { publishedAt: "desc" }, take: 30 }) : Promise.resolve([]),
    tab === "deal" ? prisma.scoutDraft.findMany({ where: { orgId: org.id, userId: user.id }, orderBy: { createdAt: "desc" }, take: 5 }) : Promise.resolve([]),
  ]);

  return (
    <Columns>
      <PageHeader title={org.name} subtitle={ORG_TYPE_LABELS[locale][org.type]} back="/orgs" />
      <section className="border-b border-line">
        <div className="h-24 bg-[linear-gradient(135deg,rgb(124_92_255/0.35),rgb(124_92_255/0.05)_60%,transparent)] sm:h-28" />
        <div className="px-4 pb-4">
          <div className="-mt-10 flex items-end justify-between gap-3">
            <span className="rounded-[22px] ring-4 ring-bg">
              <OrgLogo slug={org.slug} name={org.name} size={84} />
            </span>
            <div className="flex flex-wrap justify-end gap-2 pb-1">
              {deal ? (
                <Link href={`${base}?tab=deal`} scroll={false} className="btn-secondary">
                  <Lock size={15} /> {t(locale, "org.inMyDeals")}{isStage(deal.stage) && <span className="text-faint">· {t(locale, `stage.${deal.stage}`)}</span>}
                </Link>
              ) : (
                <form action={addToPipelineAction}>
                  <input type="hidden" name="orgId" value={org.id} />
                  <SubmitButton className="btn-secondary"><Plus size={16} /> {t(locale, "org.addToDeals")}</SubmitButton>
                </form>
              )}
              <form action={toggleFollowOrgAction}>
                <input type="hidden" name="orgId" value={org.id} />
                <button className={following ? "btn-secondary min-w-[96px]" : "btn-primary min-w-[96px]"}>{following ? t(locale, "org.unfollow") : t(locale, "org.follow")}</button>
              </form>
            </div>
          </div>
          <h2 className="mt-3 flex flex-wrap items-center gap-2 text-[22px] font-bold tracking-tight">
            {org.name}
            {org.verified ? (
              <BadgeCheck size={20} className="text-accent" />
            ) : (
              <span title={t(locale, "org.unverifiedHint")} className="inline-flex items-center gap-1 rounded-full border border-dashed border-line-strong px-2 py-0.5 text-[11px] font-medium text-faint">
                <ShieldQuestion size={12} /> {t(locale, "org.unverified")}
              </span>
            )}
          </h2>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-faint">
            <span className="text-muted">{ORG_TYPE_LABELS[locale][org.type]}</span>
            {org.country && <span className="inline-flex items-center gap-1"><MapPin size={13} />{org.country}{org.region && ` · ${REGION_LABELS[locale][org.region]}`}</span>}
            {org.website && (
              <a href={org.website} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-accent hover:underline">
                {org.website.replace(/^https?:\/\/(www\.)?/, "")} <ExternalLink size={12} />
              </a>
            )}
          </p>
          {chains.length > 0 && (
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {chains.map((c) => <span key={c} className="chip">{c}</span>)}
            </div>
          )}
          <p className="mt-2.5 flex flex-wrap gap-x-4 text-[15px]">
            <span><b>{org._count.followers}</b> <span className="text-faint">{t(locale, "profile.followers")}</span></span>
            <span title={t(locale, "claims.countHint")}><b>{verifiedMembers.length}</b> <span className="text-faint">{t(locale, "claims.verifiedMembers")}</span></span>
            <span><b>{org._count.posts}</b> <span className="text-faint">{t(locale, "org.mentions")}</span></span>
          </p>
          <p className="mt-3 rounded-xl bg-raised/70 px-3 py-2 text-[12px] leading-snug text-faint">{t(locale, "org.disclaimer").replace("{org}", org.name)}</p>
        </div>
        <Tabs
          tabs={[
            { href: base, label: t(locale, "org.tabPosts"), active: tab === "posts" },
            { href: `${base}?tab=people`, label: t(locale, "org.tabPeople"), active: tab === "people" },
            { href: `${base}?tab=news`, label: t(locale, "org.tabNews"), active: tab === "news" },
            { href: `${base}?tab=about`, label: t(locale, "org.tabAbout"), active: tab === "about" },
            ...(deal ? [{ href: `${base}?tab=deal`, label: <span className="inline-flex items-center gap-1"><Lock size={13} />{t(locale, "org.tabDeal")}</span>, active: tab === "deal" }] : []),
          ]}
        />
      </section>

      {tab === "posts" &&
        (items.length ? items.map((item) => <PostCard key={item.key} item={item} ctx={ctx} />) : <EmptyState icon={Newspaper} title={t(locale, "org.noPostsTitle")} body={t(locale, "org.noPostsBody").replace("{slug}", org.slug)} />)}

      {tab === "people" && (
        <div>
          <ClaimPanel org={org} myClaim={myClaim} user={user} locale={locale} sent={sp.claim === "sent"} error={sp.claimError} />
          {verifiedMembers.length ? (
            <ul>
              {verifiedMembers.map(({ user: m, title }) => (
                <li key={m.id} className="border-b border-line px-4 py-3">
                  <Link href={`/u/${m.handle}`} className="flex items-center gap-3">
                    <UserAvatar name={m.name} seed={m.handle} size={44} />
                    <span className="min-w-0">
                      <span className="flex items-center gap-1.5 font-semibold">{m.name} {m.isDemo && <DemoBadge locale={locale} />}</span>
                      <span className="block truncate text-sm text-faint">{title || m.headline}</span>
                      <span className="mt-1 inline-flex items-center gap-1 text-[11.5px] font-semibold text-accent-ink"><BadgeCheck size={12} /> {t(locale, "claims.verifiedMember")}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState icon={Users} title={t(locale, "org.noPeopleTitle")} body={t(locale, "claims.noMembersBody")} />
          )}
        </div>
      )}

      {tab === "news" &&
        (signals.length ? (
          <ul>
            {signals.map((s) => (
              <li key={s.id} className="border-b border-line px-4 py-3.5">
                <p className="text-xs text-faint">{s.sourceName} · {timeAgo(s.publishedAt, locale)}</p>
                {s.url ? <a href={s.url} target="_blank" rel="noreferrer" className="mt-0.5 block text-[15px] font-semibold leading-snug hover:text-accent">{s.title}</a> : <p className="mt-0.5 text-[15px] font-semibold">{s.title}</p>}
                {s.summary && <p className="mt-1 line-clamp-2 text-sm text-muted">{s.summary}</p>}
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState icon={Newspaper} title={t(locale, "org.noNewsTitle")} body={t(locale, "org.noSignals")} />
        ))}

      {tab === "about" && (
        <div className="p-4">
          <OrgFacts org={org} locale={locale} />
          <p className="mt-3 px-1 text-xs text-faint">{t(locale, "org.factsNote")}</p>
        </div>
      )}

      {tab === "deal" && deal && (
        <div className="p-4">
          <p className="mb-3 flex items-center gap-1.5 px-1 text-xs text-faint"><Lock size={12} /> {t(locale, "org.privateNote")}</p>
          <PrivateDealPanel org={org} deal={deal} drafts={drafts} locale={locale} providerName={getScoutProvider().name} scoutError={sp.scoutError} />
        </div>
      )}
    </Columns>
  );
}
