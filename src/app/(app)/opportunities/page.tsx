import Link from "next/link";
import { ChevronsUpDown, Plus, Sparkles, X } from "lucide-react";
import { createOpportunityAction } from "@/app/opportunity-actions";
import { TabPage } from "@/components/layout";
import { OpportunityCard, type OpportunityView } from "@/components/opportunity-card";
import { OpportunityFields, opportunityErrorKey } from "@/components/opportunity-form";
import { TopLine } from "@/components/shell";
import { SubmitButton } from "@/components/submit-button";
import { getLocale, requireUser } from "@/lib/auth";
import { warmPath } from "@/lib/circle";
import { prisma } from "@/lib/db";
import { t, type Locale } from "@/lib/i18n";
import { parseList } from "@/lib/json";
import { FOCUS_TAGS, isFocusTag, type FocusTag } from "@/lib/onboarding";
import { displayState, liveWhere } from "@/lib/opportunities";

export const dynamic = "force-dynamic";

type Filter = "all" | "ask" | "offer";

export default async function OpportunitiesPage({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string; topic?: string; mine?: string; new?: string; error?: string }>;
}) {
  const user = await requireUser();
  const locale = await getLocale();
  const sp = await searchParams;
  const filter: Filter = sp.kind === "ask" || sp.kind === "offer" ? sp.kind : "all";
  const topic: FocusTag | "" = sp.topic && isFocusTag(sp.topic) ? sp.topic : "";
  const mine = sp.mine === "1";
  const now = new Date();

  const where = mine
    ? { authorId: user.id }
    : { ...liveWhere(now), ...(filter === "all" ? {} : { kind: filter }), ...(topic ? { topic } : {}) };
  const [rows, edges, myCount] = await Promise.all([
    prisma.opportunity.findMany({
      where,
      include: { author: { select: { id: true, name: true, handle: true, isDemo: true } } },
      orderBy: mine ? { updatedAt: "desc" } : { createdAt: "desc" },
      take: 50,
    }),
    prisma.followUser.findMany({ select: { followerId: true, followeeId: true } }),
    prisma.opportunity.count({ where: { authorId: user.id } }),
  ]);
  const viaIds = new Set<string>();
  const paths = new Map(
    rows.map((r) => {
      const p = r.author.id === user.id ? null : warmPath(edges, user.id, r.author.id);
      if (p?.length === 3) viaIds.add(p[1]);
      return [r.id, p] as const;
    }),
  );
  const via = new Map((await prisma.user.findMany({ where: { id: { in: [...viaIds] } }, select: { id: true, name: true, handle: true } })).map((u) => [u.id, u]));
  const items: OpportunityView[] = rows.map((r) => {
    const p = paths.get(r.id);
    const v = p?.length === 3 ? via.get(p[1]) : undefined;
    const path: OpportunityView["path"] =
      r.author.id === user.id ? { kind: "self" } : p?.length === 2 ? { kind: "connected" } : v ? { kind: "intro", viaName: v.name.split(" ")[0], viaHandle: v.handle } : { kind: "none" };
    return {
      id: r.id,
      kind: r.kind,
      headline: r.headline,
      body: r.body,
      region: r.region,
      orgName: r.orgName,
      topic: r.topic,
      state: mine ? displayState(r, now) : undefined,
      author: r.author,
      path,
    };
  });

  const qs = (over: Record<string, string>) => {
    const q = new URLSearchParams();
    const merged = { kind: filter === "all" ? "" : filter, topic, ...over };
    for (const [k, val] of Object.entries(merged)) if (val) q.set(k, val);
    const s = q.toString();
    return s ? `/opportunities?${s}` : "/opportunities";
  };
  const base = mine ? "/opportunities?mine=1" : qs({});
  const myTopics = parseList(user.focusTags).filter(isFocusTag);
  // The selected topic first, then the member's focus areas, then the rest (keeps the active chip on screen).
  const topicOrder = [...new Set([...(topic ? [topic] : []), ...myTopics, ...FOCUS_TAGS])];
  const tabs: { key: Filter; label: string }[] = [
    { key: "all", label: t(locale, "opps.all") },
    { key: "ask", label: t(locale, "opps.asks") },
    { key: "offer", label: t(locale, "opps.offers") },
  ];
  const pill = (on: boolean) =>
    `shrink-0 rounded-full px-3.5 py-1.5 text-[13px] font-semibold transition ${on ? "bg-white text-accent-ink shadow-[0_1px_3px_rgb(23_21_31/0.08)]" : "text-faint hover:text-fg"}`;
  const chip = (on: boolean) =>
    `shrink-0 rounded-full border px-3 py-1 text-[12.5px] font-medium transition ${on ? "border-accent bg-accent text-white" : "border-line bg-white/70 text-muted hover:border-lilac"}`;

  return (
    <TabPage>
      <TopLine
        eyebrow={t(locale, "nav.opportunities")}
        user={{ name: user.name, handle: user.handle, isDemo: user.isDemo, avatarKey: user.avatarKey }}
        right={
          <Link
            href={`${base}${base.includes("?") ? "&" : "?"}new=1`}
            scroll={false}
            aria-label={t(locale, "opps.post")}
            title={t(locale, "opps.post")}
            className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-accent-soft text-accent-ink transition hover:bg-lilac/60 active:scale-95"
          >
            <Plus size={18} />
          </Link>
        }
      />
      <div className="mt-3">
        <h1 className="text-[32px] font-semibold leading-[1.1] tracking-[-0.02em] md:text-[40px]">{t(locale, mine ? "opps.mine" : "opps.title")}</h1>
        <p className="mt-0.5 text-[20px] font-medium tracking-[-0.01em] text-faint md:text-[24px]">{t(locale, mine ? "opps.mineSub" : "opps.subtitle")}</p>
      </div>

      <div className="mt-5 flex items-center justify-between gap-2">
        <nav className="inline-flex rounded-full border border-white/80 bg-white/60 p-1 backdrop-blur-xl" aria-label="Filter">
          {tabs.map((tab) => (
            <Link key={tab.key} href={qs({ kind: tab.key === "all" ? "" : tab.key })} scroll={false} className={pill(!mine && filter === tab.key)}>
              {tab.label}
            </Link>
          ))}
        </nav>
        {(myCount > 0 || mine) && (
          <Link href={mine ? "/opportunities" : "/opportunities?mine=1"} scroll={false} className="rounded-full border border-white/80 bg-white/60 p-1 backdrop-blur-xl">
            <span className={`block ${pill(mine)}`}>{t(locale, "opps.yoursN").replace("{n}", String(myCount))}</span>
          </Link>
        )}
      </div>

      {!mine && (
        <nav className="no-scrollbar -mx-4 mt-3 flex gap-1.5 overflow-x-auto px-4 pb-1" aria-label={t(locale, "opps.topic")}>
          <Link href={qs({ topic: "" })} scroll={false} className={chip(!topic)}>{t(locale, "opps.allTopics")}</Link>
          {topicOrder.map((x) => (
            <Link key={x} href={qs({ topic: x })} scroll={false} className={chip(topic === x)}>{t(locale, `focus.${x}`)}</Link>
          ))}
        </nav>
      )}

      {items.length === 0 ? (
        <EmptyOpportunities locale={locale} filter={filter} topic={topic} mine={mine} newHref={`${qs({})}${qs({}).includes("?") ? "&" : "?"}new=1`} myTopics={myTopics} />
      ) : (
        <>
          {/* Wallet-style stack: cards overlap slightly; on mobile the stack scrolls and snaps card by card. */}
          <div className="no-scrollbar relative -mx-1 mt-4 flex max-h-[calc(100dvh-360px)] snap-y snap-mandatory flex-col overflow-y-auto px-1 pb-4 pt-1 md:max-h-none md:overflow-visible">
            {items.map((o, i) => (
              <div key={o.id} className={i === 0 ? "" : "-mt-3"} style={{ zIndex: i + 1 }}>
                <OpportunityCard o={o} locale={locale} index={i} />
              </div>
            ))}
          </div>
          {items.length > 2 && (
            <p className="mt-1 flex items-center justify-center gap-1.5 text-[12px] text-faint md:hidden">
              <ChevronsUpDown size={13} /> {t(locale, "opps.swipe")}
            </p>
          )}
        </>
      )}

      {sp.new && (
        <NewOpportunitySheet
          locale={locale}
          close={base}
          orgName={user.orgName}
          kind={filter === "offer" ? "offer" : "ask"}
          topic={topic || myTopics[0] || ""}
          region={user.region}
          error={sp.error}
        />
      )}
    </TabPage>
  );
}

function EmptyOpportunities({
  locale,
  filter,
  topic,
  mine,
  newHref,
  myTopics,
}: {
  locale: Locale;
  filter: Filter;
  topic: FocusTag | "";
  mine: boolean;
  newHref: string;
  myTopics: FocusTag[];
}) {
  const kindWord = t(locale, filter === "offer" ? "opps.anOffer" : "opps.anAsk");
  const title = mine
    ? t(locale, "opps.emptyMine")
    : topic
      ? t(locale, "opps.emptyTopic").replace("{kind}", kindWord).replace("{topic}", t(locale, `focus.${topic}`))
      : t(locale, "opps.emptyAll");
  const body = mine ? t(locale, "opps.emptyMineBody") : t(locale, "opps.emptyBody");
  const cta = topic ? t(locale, "opps.postIn").replace("{kind}", kindWord).replace("{topic}", t(locale, `focus.${topic}`)) : t(locale, "opps.postFirst");
  return (
    <section className="glass mt-5 overflow-hidden px-6 pb-6 pt-7 text-center animate-fade-in">
      <span className="mx-auto mb-4 inline-flex h-14 w-14 items-center justify-center rounded-[20px] bg-gradient-to-br from-accent-soft to-white text-accent shadow-[0_8px_24px_-12px_rgb(124_58_237/0.5)]">
        <Sparkles size={24} />
      </span>
      <h2 className="text-[19px] font-semibold leading-snug tracking-tight text-balance">{title}</h2>
      <p className="mx-auto mt-1.5 max-w-[300px] text-[14px] leading-relaxed text-muted">{body}</p>
      <Link href={newHref} scroll={false} className="btn-primary mt-5 h-11 px-6">
        <Plus size={16} /> {cta}
      </Link>
      {!mine && !topic && myTopics.length > 0 && (
        <div className="mt-5 border-t border-line/70 pt-4">
          <p className="text-[12px] font-medium uppercase tracking-[0.12em] text-faint">{t(locale, "opps.startIn")}</p>
          <div className="mt-2 flex flex-wrap justify-center gap-1.5">
            {myTopics.map((x) => (
              <Link key={x} href={`/opportunities?topic=${x}&new=1`} scroll={false} className="rounded-full border border-lilac/70 bg-white/80 px-3 py-1 text-[12.5px] font-medium text-accent-ink hover:bg-accent-soft">
                {t(locale, `focus.${x}`)}
              </Link>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function NewOpportunitySheet({
  locale,
  close,
  orgName,
  kind,
  topic,
  region,
  error,
}: {
  locale: Locale;
  close: string;
  orgName: string;
  kind: string;
  topic: string;
  region: string;
  error?: string;
}) {
  const errKey = opportunityErrorKey(error);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center animate-fade-in md:items-center md:p-6" role="dialog" aria-modal="true" aria-labelledby="new-opp">
      <Link href={close} scroll={false} aria-label={t(locale, "opps.cancel")} className="absolute inset-0 bg-zinc-900/25 backdrop-blur-sm" />
      <div className="relative max-h-[92dvh] w-full max-w-[520px] animate-rise overflow-y-auto rounded-t-[30px] border border-white bg-white/95 px-6 pb-[max(24px,env(safe-area-inset-bottom))] pt-3 shadow-2xl backdrop-blur-2xl md:rounded-[30px] md:pb-6">
        <span className="mx-auto mb-3 block h-1.5 w-10 rounded-full bg-line-strong md:hidden" />
        <div className="flex items-center justify-between">
          <h2 id="new-opp" className="text-[19px] font-semibold tracking-tight">{t(locale, "opps.new")}</h2>
          <Link href={close} scroll={false} className="btn-ghost h-9 w-9 p-0" aria-label={t(locale, "opps.cancel")}>
            <X size={18} />
          </Link>
        </div>
        {errKey && <p className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{t(locale, errKey)}</p>}
        <form action={createOpportunityAction} className="mt-4 space-y-4">
          <input type="hidden" name="back" value={close} />
          <OpportunityFields locale={locale} d={{ kind, headline: "", body: "", region, topic, orgName }} />
          <SubmitButton className="btn-primary h-12 w-full">{t(locale, "opps.submit")}</SubmitButton>
        </form>
      </div>
    </div>
  );
}
