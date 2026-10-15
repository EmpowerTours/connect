import Link from "next/link";
import { Newspaper, RefreshCw } from "lucide-react";
import { addSignalAction, ingestNowAction } from "@/app/actions";
import { OrgLogo } from "@/components/avatar";
import { EmptyState } from "@/components/empty-state";
import { Columns, PageHeader, RailCard, Tabs } from "@/components/layout";
import { SubmitButton } from "@/components/submit-button";
import { timeAgo } from "@/components/time";
import { getLocale, requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { t } from "@/lib/i18n";

export const dynamic = "force-dynamic";

export default async function SignalsPage({ searchParams }: { searchParams: Promise<{ scope?: string }> }) {
  const user = await requireUser();
  const locale = await getLocale();
  const scope = (await searchParams).scope;
  const followed = (await prisma.followOrg.findMany({ where: { userId: user.id }, select: { orgId: true } })).map((f) => f.orgId);
  const where = scope === "following" ? { orgs: { some: { orgId: { in: followed } } } } : scope === "all" ? {} : { orgs: { some: {} } };
  const [signals, feeds] = await Promise.all([
    prisma.signal.findMany({ where, include: { orgs: { include: { org: { select: { slug: true, name: true } } } } }, orderBy: { publishedAt: "desc" }, take: 60 }),
    prisma.rssFeed.findMany({ orderBy: { name: "asc" } }),
  ]);
  const rail = (
    <div className="space-y-4">
      <RailCard title={t(locale, "feed.sources")}>
        <div className="px-4 pb-4 pt-2">
          <form action={ingestNowAction} className="mb-3">
            <SubmitButton className="btn-secondary w-full"><RefreshCw size={15} /> {t(locale, "feed.refresh")}</SubmitButton>
          </form>
          <ul className="space-y-1.5 text-[13px]">
            {feeds.map((f) => (
              <li key={f.id} className="flex justify-between gap-2">
                <span>{f.name}</span>
                <span className={f.lastError ? "text-danger" : "text-faint"}>{f.lastError ?? (f.lastFetchedAt ? timeAgo(f.lastFetchedAt, locale) : "—")}</span>
              </li>
            ))}
          </ul>
        </div>
      </RailCard>
      <RailCard title={t(locale, "feed.addSignal")}>
        <form action={addSignalAction} className="space-y-2 px-4 pb-4 pt-2">
          <input name="title" required placeholder={t(locale, "feed.signalTitle")} className="input" />
          <input name="url" type="url" placeholder={t(locale, "feed.signalUrl")} className="input" />
          <textarea name="summary" rows={2} placeholder={t(locale, "feed.signalSummary")} className="input" />
          <SubmitButton className="btn-primary w-full">{t(locale, "feed.add")}</SubmitButton>
        </form>
      </RailCard>
    </div>
  );
  return (
    <Columns>
      <PageHeader title={t(locale, "signals.title")} subtitle={t(locale, "signals.subtitle")} back="/more">
        <Tabs
          tabs={[
            { href: "/signals", label: t(locale, "signals.tagged"), active: !scope },
            { href: "/signals?scope=following", label: t(locale, "feed.following"), active: scope === "following" },
            { href: "/signals?scope=all", label: t(locale, "feed.all"), active: scope === "all" },
          ]}
        />
      </PageHeader>
      {signals.length === 0 && <EmptyState icon={Newspaper} title={t(locale, "feed.empty")} body={t(locale, "org.noSignals")} />}
      <ul>
        {signals.map((s) => (
          <li key={s.id} className="border-b border-line px-4 py-3.5">
            <p className="text-xs text-faint">{s.source === "manual" ? `✎ ${s.sourceName}` : s.sourceName} · {timeAgo(s.publishedAt, locale)}</p>
            {s.url ? <a href={s.url} target="_blank" rel="noreferrer" className="mt-0.5 block text-[15px] font-semibold leading-snug hover:text-accent">{s.title}</a> : <p className="mt-0.5 text-[15px] font-semibold">{s.title}</p>}
            {s.summary && <p className="mt-1 line-clamp-2 text-sm text-muted">{s.summary}</p>}
            {s.orgs.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {s.orgs.map(({ org }) => (
                  <Link key={org.slug} href={`/orgs/${org.slug}`} className="inline-flex items-center gap-1.5 rounded-full border border-line py-0.5 pl-0.5 pr-2.5 text-xs font-medium text-muted hover:text-fg">
                    <OrgLogo slug={org.slug} name={org.name} size={18} />{org.name}
                  </Link>
                ))}
              </div>
            )}
          </li>
        ))}
      </ul>
      <div className="p-4">{rail}</div>
    </Columns>
  );
}
