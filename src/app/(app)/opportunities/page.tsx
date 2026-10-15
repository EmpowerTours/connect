import Link from "next/link";
import { ChevronsUpDown, Plus, X } from "lucide-react";
import { createOpportunityAction } from "@/app/actions";
import { TabPage } from "@/components/layout";
import { OpportunityCard, type OpportunityView } from "@/components/opportunity-card";
import { TopLine } from "@/components/shell";
import { SubmitButton } from "@/components/submit-button";
import { getLocale, requireUser } from "@/lib/auth";
import { warmPath } from "@/lib/circle";
import { REGIONS } from "@/lib/constants";
import { prisma } from "@/lib/db";
import { REGION_LABELS, t, type Locale } from "@/lib/i18n";
import { OPP_BODY_MAX, OPP_HEADLINE_MAX } from "@/lib/opportunities";

export const dynamic = "force-dynamic";

type Filter = "all" | "ask" | "offer";

export default async function OpportunitiesPage({ searchParams }: { searchParams: Promise<{ kind?: string; new?: string; error?: string }> }) {
  const user = await requireUser();
  const locale = await getLocale();
  const sp = await searchParams;
  const filter: Filter = sp.kind === "ask" || sp.kind === "offer" ? sp.kind : "all";
  const [rows, edges] = await Promise.all([
    prisma.opportunity.findMany({
      where: filter === "all" ? {} : { kind: filter },
      include: { author: { select: { id: true, name: true, handle: true, isDemo: true } } },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
    prisma.followUser.findMany({ select: { followerId: true, followeeId: true } }),
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
    return { id: r.id, kind: r.kind, headline: r.headline, body: r.body, region: r.region, orgName: r.orgName, author: r.author, path };
  });
  const tabs: { key: Filter; label: string }[] = [
    { key: "all", label: t(locale, "opps.all") },
    { key: "ask", label: t(locale, "opps.asks") },
    { key: "offer", label: t(locale, "opps.offers") },
  ];
  const base = filter === "all" ? "/opportunities" : `/opportunities?kind=${filter}`;

  return (
    <TabPage>
      <TopLine
        eyebrow={t(locale, "nav.opportunities")}
        user={{ name: user.name, handle: user.handle, isDemo: user.isDemo }}
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
        <h1 className="text-[32px] font-semibold leading-[1.1] tracking-[-0.02em] md:text-[40px]">{t(locale, "opps.title")}</h1>
        <p className="mt-0.5 text-[20px] font-medium tracking-[-0.01em] text-faint md:text-[24px]">{t(locale, "opps.subtitle")}</p>
      </div>

      <nav className="mt-5 inline-flex rounded-full border border-white/80 bg-white/60 p-1 backdrop-blur-xl" aria-label="Filter">
        {tabs.map((tab) => (
          <Link
            key={tab.key}
            href={tab.key === "all" ? "/opportunities" : `/opportunities?kind=${tab.key}`}
            scroll={false}
            className={`rounded-full px-4 py-1.5 text-[13px] font-semibold transition ${filter === tab.key ? "bg-white text-accent-ink shadow-[0_1px_3px_rgb(23_21_31/0.08)]" : "text-faint hover:text-fg"}`}
          >
            {tab.label}
          </Link>
        ))}
      </nav>

      {items.length === 0 ? (
        <p className="glass mt-5 px-5 py-6 text-center text-sm text-muted">{t(locale, "opps.empty")}</p>
      ) : (
        <>
          {/* Wallet-style stack: cards overlap slightly; on mobile the stack scrolls and snaps card by card. */}
          <div className="no-scrollbar relative -mx-1 mt-4 flex max-h-[calc(100dvh-318px)] snap-y snap-mandatory flex-col overflow-y-auto px-1 pb-4 pt-1 md:max-h-none md:overflow-visible">
            {items.map((o, i) => (
              <div key={o.id} className={i === 0 ? "" : "-mt-3"} style={{ zIndex: i + 1 }}>
                <OpportunityCard o={o} locale={locale} index={i} />
              </div>
            ))}
          </div>
          <p className="mt-1 flex items-center justify-center gap-1.5 text-[12px] text-faint md:hidden">
            <ChevronsUpDown size={13} /> {t(locale, "opps.swipe")}
          </p>
        </>
      )}

      {sp.new && <NewOpportunitySheet locale={locale} close={base} orgName={user.orgName} error={sp.error} />}
    </TabPage>
  );
}

const ERROR_KEYS = {
  kind: "opps.err.kind",
  headline_empty: "opps.err.headline_empty",
  headline_long: "opps.err.headline_long",
  body_long: "opps.err.body_long",
  region: "opps.err.region",
} as const;

function NewOpportunitySheet({ locale, close, orgName, error }: { locale: Locale; close: string; orgName: string; error?: string }) {
  const errKey = error && error in ERROR_KEYS ? ERROR_KEYS[error as keyof typeof ERROR_KEYS] : null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center animate-fade-in md:items-center md:p-6" role="dialog" aria-modal="true" aria-labelledby="new-opp">
      <Link href={close} scroll={false} aria-label={t(locale, "opps.cancel")} className="absolute inset-0 bg-zinc-900/25 backdrop-blur-sm" />
      <div className="relative w-full max-w-[520px] animate-rise rounded-t-[30px] border border-white bg-white/95 px-6 pb-[max(24px,env(safe-area-inset-bottom))] pt-3 shadow-2xl backdrop-blur-2xl md:rounded-[30px] md:pb-6">
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
          <fieldset>
            <legend className="label">{t(locale, "opps.kind")}</legend>
            <div className="inline-flex rounded-full bg-raised p-1">
              {(["ask", "offer"] as const).map((k, i) => (
                <label key={k} className="cursor-pointer rounded-full px-4 py-1.5 text-[13px] font-semibold text-faint transition has-[:checked]:bg-white has-[:checked]:text-accent-ink has-[:checked]:shadow-sm">
                  <input type="radio" name="kind" value={k} defaultChecked={i === 0} className="sr-only" />
                  {t(locale, k === "ask" ? "opps.ask" : "opps.offer")}
                </label>
              ))}
            </div>
          </fieldset>
          <label className="block">
            <span className="label">{t(locale, "opps.headline")}</span>
            <input name="headline" required maxLength={OPP_HEADLINE_MAX} className="input" placeholder={t(locale, "opps.headlinePh")} />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="label">{t(locale, "opps.org")}</span>
              <input name="orgName" defaultValue={orgName} maxLength={80} className="input" />
            </label>
            <label className="block">
              <span className="label">{t(locale, "opps.region")}</span>
              <select name="region" className="input" defaultValue="">
                <option value="">{t(locale, "opps.anyRegion")}</option>
                {REGIONS.map((r) => (
                  <option key={r} value={r}>{REGION_LABELS[locale][r]}</option>
                ))}
              </select>
            </label>
          </div>
          <label className="block">
            <span className="label">{t(locale, "opps.body")}</span>
            <textarea name="body" rows={3} maxLength={OPP_BODY_MAX} className="input" placeholder={t(locale, "opps.bodyPh")} />
          </label>
          <SubmitButton className="btn-primary h-12 w-full">{t(locale, "opps.submit")}</SubmitButton>
        </form>
      </div>
    </div>
  );
}
