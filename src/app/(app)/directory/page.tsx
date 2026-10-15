import Link from "next/link";
import { createOrgAction, toggleFollowOrgAction } from "@/app/actions";
import { OrgTypeBadge } from "@/components/ui";
import { getLocale, getWorkspace, requireUser } from "@/lib/auth";
import { ORG_TYPES, REGIONS } from "@/lib/constants";
import { prisma } from "@/lib/db";
import { ORG_TYPE_LABELS, REGION_LABELS, t } from "@/lib/i18n";
import { parseList } from "@/lib/json";
import { STAGES } from "@/lib/pipeline";

export const dynamic = "force-dynamic";

export default async function DirectoryPage({ searchParams }: { searchParams: Promise<{ q?: string; type?: string; region?: string }> }) {
  const user = await requireUser();
  const locale = await getLocale();
  const ws = await getWorkspace(user.id);
  const { q = "", type = "", region = "" } = await searchParams;

  const orgs = await prisma.organization.findMany({
    where: {
      ...(type ? { type } : {}),
      ...(region ? { region } : {}),
      ...(q
        ? { OR: [{ name: { contains: q } }, { country: { contains: q.toUpperCase() } }, { aliases: { contains: q } }, { chainsInUse: { contains: q } }, { chainsEvaluating: { contains: q } }, { notes: { contains: q } }] }
        : {}),
    },
    include: {
      deals: { where: { workspaceId: ws.id }, select: { stage: true } },
      followers: { where: { userId: user.id }, select: { userId: true } },
      _count: { select: { signals: true } },
    },
    orderBy: { name: "asc" },
  });
  orgs.sort((a, b) => a.name.localeCompare(b.name, locale));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t(locale, "directory.title")}</h1>
          <p className="text-sm text-zinc-400">
            {orgs.length} {t(locale, "directory.count")}
          </p>
        </div>
        <details className="relative">
          <summary className="btn-ghost cursor-pointer list-none">+ {t(locale, "directory.add")}</summary>
          <form action={createOrgAction} className="card absolute right-0 z-20 mt-2 w-72 space-y-2 p-3 shadow-xl">
            <input name="name" required placeholder={t(locale, "org.name")} className="input" />
            <select name="type" className="input" defaultValue="fintech">
              {ORG_TYPES.map((ty) => (
                <option key={ty} value={ty}>{ORG_TYPE_LABELS[locale][ty]}</option>
              ))}
            </select>
            <input name="country" placeholder={`${t(locale, "org.country")} (ISO-2, e.g. MX)`} maxLength={2} className="input" />
            <input name="website" placeholder="https://" className="input" />
            <button className="btn-primary w-full">{t(locale, "org.create")}</button>
          </form>
        </details>
      </div>

      <form className="flex flex-col gap-2 sm:flex-row">
        <input name="q" defaultValue={q} placeholder={t(locale, "directory.search")} className="input sm:flex-1" />
        <select name="type" defaultValue={type} className="input sm:w-56">
          <option value="">{t(locale, "directory.allTypes")}</option>
          {ORG_TYPES.map((ty) => (
            <option key={ty} value={ty}>{ORG_TYPE_LABELS[locale][ty]}</option>
          ))}
        </select>
        <select name="region" defaultValue={region} className="input sm:w-48">
          <option value="">{t(locale, "directory.allRegions")}</option>
          {REGIONS.map((r) => (
            <option key={r} value={r}>{REGION_LABELS[locale][r]}</option>
          ))}
        </select>
        <button className="btn-primary">{t(locale, "directory.filter")}</button>
      </form>

      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {orgs.map((o) => {
          const chains = parseList(o.chainsInUse);
          const deal = o.deals[0];
          const following = o.followers.length > 0;
          return (
            <li key={o.id} className="card flex flex-col gap-2 p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <Link href={`/orgs/${o.slug}`} className="block truncate font-semibold hover:text-violet-300">{o.name}</Link>
                  <p className="truncate text-xs text-zinc-500">
                    {[o.country, o.region && REGION_LABELS[locale][o.region], o.website.replace(/^https?:\/\/(www\.)?/, "")].filter(Boolean).join(" · ")}
                  </p>
                </div>
                <form action={toggleFollowOrgAction}>
                  <input type="hidden" name="orgId" value={o.id} />
                  <button className={`chip ${following ? "border-violet-500/60 text-violet-300" : "hover:border-zinc-500"}`}>
                    {following ? `✓ ${t(locale, "org.unfollow")}` : `+ ${t(locale, "org.follow")}`}
                  </button>
                </form>
              </div>
              <div className="flex flex-wrap gap-1">
                <OrgTypeBadge type={o.type} locale={locale} />
                {chains.map((c) => (
                  <span key={c} className="chip">{c}</span>
                ))}
                {deal && STAGES.includes(deal.stage as (typeof STAGES)[number]) && (
                  <span className="chip border-emerald-500/40 text-emerald-300">
                    {t(locale, "directory.inPipeline")}: {t(locale, `stage.${deal.stage as (typeof STAGES)[number]}`)}
                  </span>
                )}
                {o._count.signals > 0 && <span className="chip text-zinc-400">≋ {o._count.signals}</span>}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
