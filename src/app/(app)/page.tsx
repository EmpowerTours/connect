import Link from "next/link";
import { ArrowUpRight, Check, ChevronRight, Clock3, KanbanSquare, Sparkles } from "lucide-react";
import { OrgLogo, UserAvatar } from "@/components/avatar";
import { avatarUrl } from "@/lib/media";
import { DemoBadge } from "@/components/badges";
import { Greeting } from "@/components/greeting";
import { TabPage } from "@/components/layout";
import { TopLine } from "@/components/shell";
import { timeAgo } from "@/components/time";
import { getLocale, getWorkspace, requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { t, type Locale } from "@/lib/i18n";
import { connectionsOf } from "@/lib/intros";
import { onboardingChecklist, profileComplete, type ChecklistKey } from "@/lib/onboarding";
import { needsAttention } from "@/lib/pipeline";
import { firstName, pickInsight } from "@/lib/today";

export const dynamic = "force-dynamic";

export default async function TodayPage({ searchParams }: { searchParams: Promise<{ welcome?: string }> }) {
  const user = await requireUser();
  const locale = await getLocale();
  const now = new Date();
  const ws = await getWorkspace(user.id);
  const welcome = (await searchParams).welcome === "1";
  // Hero: the busiest org in public news this week, falling back to the last 30 days for quiet weeks.
  const since = new Date(now.getTime() - 30 * 86_400_000);
  const [requests, deals, follows, signals, claims, myOpps, edges] = await Promise.all([
    prisma.intro.findMany({
      where: { connectorId: user.id, status: "pending" },
      include: { requester: true, target: true, opportunity: { select: { kind: true } } },
      orderBy: { createdAt: "desc" },
    }),
    prisma.deal.findMany({ where: { workspaceId: ws.id }, include: { org: { select: { name: true, slug: true } } } }),
    prisma.followOrg.findMany({ where: { userId: user.id }, select: { org: { select: { slug: true } } } }),
    prisma.signal.findMany({
      where: { publishedAt: { gte: since }, orgs: { some: {} } },
      include: { orgs: { include: { org: { select: { slug: true, name: true } } } } },
      orderBy: { publishedAt: "desc" },
      take: 300,
    }),
    prisma.orgClaim.findMany({ where: { userId: user.id, status: { in: ["pending", "approved"] } }, select: { status: true } }),
    prisma.opportunity.count({ where: { authorId: user.id } }),
    prisma.followUser.findMany({ where: { OR: [{ followerId: user.id }, { followeeId: user.id }] }, select: { followerId: true, followeeId: true } }),
  ]);
  const myOrg = user.orgId ? await prisma.organization.findUnique({ where: { id: user.orgId }, select: { slug: true } }) : null;
  const priority = new Set([...deals.map((d) => d.org.slug), ...follows.map((f) => f.org.slug), ...(myOrg ? [myOrg.slug] : [])]);
  const insightSignals = signals
    .filter((s) => (locale === "en" ? !/\(ES\)$/.test(s.sourceName) : true))
    .flatMap((s) => s.orgs.map((o) => ({ orgSlug: o.org.slug, orgName: o.org.name, title: s.title, sourceName: s.sourceName, url: s.url, publishedAt: s.publishedAt })));
  const insight = pickInsight(insightSignals, priority, now, 7) ?? pickInsight(insightSignals, priority, now, 30);
  const checklist = onboardingChecklist({
    profileComplete: profileComplete(user),
    claimStatus: claims.some((c) => c.status === "approved") ? "approved" : claims.length ? "pending" : "none",
    opportunities: myOpps,
    connections: connectionsOf(edges, user.id).size,
  });
  const showChecklist = !user.isDemo && !checklist.complete;
  const claimHref = myOrg ? `/orgs/${myOrg.slug}?tab=people` : "/orgs";
  const attention = needsAttention(deals, now).length;
  const user1 = { name: user.name, handle: user.handle, isDemo: user.isDemo, avatarKey: user.avatarKey };

  return (
    <TabPage>
      <TopLine eyebrow={t(locale, "nav.today")} user={user1} />
      <div className="mt-3 animate-rise">
        <Greeting name={firstName(user.name)} locale={locale} serverHour={now.getHours()} />
        <p className="mt-3 text-[15px] text-muted">{t(locale, welcome ? "today.welcome" : showChecklist ? "today.newHere" : "today.attention")}</p>
      </div>

      {/* Hero insight */}
      {insight ? (
        <Link
          href={`/orgs/${insight.orgSlug}?tab=news`}
          className="group relative mt-7 block overflow-hidden rounded-[28px] border border-white/80 p-6 shadow-[0_1px_2px_rgb(23_21_31/0.04),0_18px_40px_-18px_rgb(91_33_182/0.35)] transition active:scale-[0.99]"
          style={{ background: "linear-gradient(140deg, #faf8ff 0%, #efe9ff 42%, #ddd0ff 100%)" }}
        >
          <span aria-hidden className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-lilac/50 blur-3xl" />
          <span aria-hidden className="pointer-events-none absolute -bottom-24 left-10 h-48 w-48 rounded-full bg-white/70 blur-3xl" />
          <div className="relative">
            <p className="flex items-center gap-1.5 text-[12px] font-semibold text-accent-ink">
              <Sparkles size={13} /> {t(locale, "today.insightKicker")}
            </p>
            <h2 className="mt-2.5 text-[22px] font-semibold leading-snug tracking-[-0.01em] text-fg">
              {t(locale, "today.inTheNews").replace("{org}", insight.orgName)}
              <br />
              <span className="text-accent">
                {insight.count === 1 ? t(locale, "today.newSignal") : t(locale, "today.newSignals").replace("{n}", String(insight.count))}
              </span>
            </h2>
            <p className="mt-3 line-clamp-3 pr-6 text-[15px] leading-relaxed text-muted">“{insight.latest.title}”</p>
            <div className="mt-5 flex items-end justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-white/80 py-0.5 pl-0.5 pr-3 text-[12px] font-semibold text-accent-ink">
                  <OrgLogo slug={insight.orgSlug} name={insight.orgName} size={22} />
                  {insight.orgName}
                </span>
                {insight.inPipeline && <span className="rounded-full bg-white/60 px-3 py-1 text-[12px] font-medium text-muted">{t(locale, "today.inDeals")}</span>}
                <span className="text-[12px] text-faint">
                  {insight.latest.sourceName} · {timeAgo(insight.latest.publishedAt, locale, now)}
                </span>
              </div>
              <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-white bg-white/70 text-accent transition group-hover:bg-white">
                <ArrowUpRight size={19} />
              </span>
            </div>
          </div>
        </Link>
      ) : (
        <div className="glass mt-7 p-6">
          <p className="text-[17px] font-semibold">{t(locale, "today.noInsightTitle")}</p>
          <p className="mt-1 text-sm text-muted">{t(locale, "today.noInsightBody")}</p>
        </div>
      )}

      {showChecklist && (
        <section className="mt-9" aria-labelledby="getting-started">
          <div className="mb-3 flex items-baseline justify-between px-1">
            <h2 id="getting-started" className="text-[17px] font-semibold tracking-tight">{t(locale, "today.getStarted")}</h2>
            <span className="text-[13px] font-semibold text-accent-ink">{t(locale, "today.progress").replace("{done}", String(checklist.done)).replace("{total}", String(checklist.total))}</span>
          </div>
          <div className="glass overflow-hidden rounded-[24px]! p-1.5">
            <div className="mx-3.5 mb-1 mt-2.5 h-1.5 overflow-hidden rounded-full bg-lavender/70">
              <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${Math.max(4, (checklist.done / checklist.total) * 100)}%` }} />
            </div>
            <ul>
              {checklist.items.map((item) => (
                <li key={item.key}>
                  <ChecklistRow
                    item={item.key}
                    done={item.done}
                    pending={!!item.pending}
                    href={item.key === "claim" ? claimHref : item.href}
                    locale={locale}
                  />
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      {/* Intro requests waiting on you */}
      {(requests.length > 0 || !showChecklist) && (
      <section className="mt-9">
        <div className="mb-3 flex items-baseline justify-between px-1">
          <h2 className="text-[17px] font-semibold tracking-tight">
            {t(locale, "today.introRequests")}
            {requests.length > 0 && <span className="ml-2 text-[15px] font-medium text-faint">{requests.length}</span>}
          </h2>
          <Link href="/intros" className="text-[13px] font-semibold text-accent hover:text-accent-hover">{t(locale, "today.seeAll")}</Link>
        </div>
        {requests.length === 0 ? (
          <p className="glass px-5 py-4 text-sm text-muted">{t(locale, "today.noRequests")}</p>
        ) : (
          <ul className="space-y-2.5">
            {requests.map((r) => (
              <li key={r.id}>
                <Link href="/intros" className="glass flex items-center gap-3.5 rounded-[22px]! px-4 py-3.5 transition hover:bg-white/90 active:scale-[0.99]">
                  <span className="relative">
                    <UserAvatar name={r.requester.name} seed={r.requester.handle} src={avatarUrl(r.requester.avatarKey)} size={46} />
                    <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full bg-accent ring-2 ring-white" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate text-[15px] font-semibold">{r.requester.name}</span>
                      {r.requester.isDemo && <DemoBadge locale={locale} />}
                    </span>
                    <span className="block truncate text-[13px] text-faint">{[r.requester.headline, r.requester.orgName].filter(Boolean).join(", ")}</span>
                    <span className="mt-0.5 block truncate text-[12.5px] font-medium text-accent-ink">
                      {r.mode === "direct"
                        ? t(locale, r.opportunity?.kind === "offer" ? "today.aboutYourOffer" : "today.aboutYourAsk")
                        : `${t(locale, "today.wantsIntro")} ${t(locale, "today.toTarget").replace("{name}", firstName(r.target.name))}`}
                    </span>
                  </span>
                  <ChevronRight size={18} className="shrink-0 text-faint" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
      )}

      {attention > 0 && (
        <section className="mt-8">
          <h2 className="mb-3 px-1 text-[17px] font-semibold tracking-tight">{t(locale, "today.alsoToday")}</h2>
          <Link href="/pipeline" className="glass flex items-center gap-3.5 rounded-[22px]! px-4 py-3.5 transition hover:bg-white/90">
            <span className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-accent-soft text-accent">
              <KanbanSquare size={19} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[15px] font-semibold">{attention === 1 ? t(locale, "today.followUp") : t(locale, "today.followUps").replace("{n}", String(attention))}</span>
              <span className="block truncate text-[13px] text-faint">{t(locale, "nav.deals")}</span>
            </span>
            <ChevronRight size={18} className="text-faint" />
          </Link>
        </section>
      )}
      <p className="mt-8 px-1 text-center text-[11.5px] text-faint">{t(locale, "today.publicNews")}</p>
    </TabPage>
  );
}

const CHECK_ICON_BG = "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full";

function ChecklistRow({ item, done, pending, href, locale }: { item: ChecklistKey; done: boolean; pending: boolean; href: string; locale: Locale }) {
  const body = (
    <>
      {done ? (
        <span className={`${CHECK_ICON_BG} bg-accent text-white`}><Check size={17} strokeWidth={2.6} /></span>
      ) : pending ? (
        <span className={`${CHECK_ICON_BG} bg-amber-100 text-amber-700`}><Clock3 size={17} /></span>
      ) : (
        <span className={`${CHECK_ICON_BG} border-2 border-dashed border-lilac bg-white/70`} />
      )}
      <span className="min-w-0 flex-1">
        <span className={`block text-[15px] font-semibold ${done ? "text-faint line-through decoration-lilac" : ""}`}>{t(locale, `today.check.${item}`)}</span>
        <span className="block truncate text-[13px] text-faint">
          {pending ? t(locale, "today.check.claimPending") : t(locale, `today.check.${item}Hint`)}
        </span>
      </span>
      {!done && !pending && <ChevronRight size={18} className="shrink-0 text-faint" />}
    </>
  );
  return done || pending ? (
    <div className="flex items-center gap-3.5 rounded-[18px] px-3.5 py-3">{body}</div>
  ) : (
    <Link href={href} className="flex items-center gap-3.5 rounded-[18px] px-3.5 py-3 transition hover:bg-white/80 active:scale-[0.99]">{body}</Link>
  );
}
