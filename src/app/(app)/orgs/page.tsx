import Link from "next/link";
import { Building2, Plus, Search } from "lucide-react";
import { createOrgAction } from "@/app/actions";
import { OrgLogo } from "@/components/avatar";
import { EmptyState } from "@/components/empty-state";
import { Columns, PageHeader } from "@/components/layout";
import { getLocale, getWorkspace, requireUser } from "@/lib/auth";
import { ORG_TYPES, REGIONS } from "@/lib/constants";
import { prisma } from "@/lib/db";
import { ORG_TYPE_LABELS, REGION_LABELS, t } from "@/lib/i18n";

export const dynamic = "force-dynamic";

export default async function OrgsPage({ searchParams }: { searchParams: Promise<{ q?: string; type?: string; region?: string }> }) {
  const user = await requireUser();
  const locale = await getLocale();
  const ws = await getWorkspace(user.id);
  const { q = "", type = "", region = "" } = await searchParams;
  const orgs = await prisma.organization.findMany({
    where: {
      ...(type ? { type } : {}),
      ...(region ? { region } : {}),
      ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { country: { contains: q.toUpperCase() } }, { aliases: { contains: q, mode: "insensitive" } }, { chainsInUse: { contains: q, mode: "insensitive" } }] } : {}),
    },
    include: {
      deals: { where: { workspaceId: ws.id }, select: { stage: true } },
      followers: { where: { userId: user.id }, select: { userId: true } },
      _count: { select: { followers: true, posts: true } },
    },
  });
  orgs.sort((a, b) => a.name.localeCompare(b.name, locale));
  const typeHref = (ty: string) => `/orgs?${new URLSearchParams({ ...(q ? { q } : {}), ...(ty ? { type: ty } : {}), ...(region ? { region } : {}) })}`;

  return (
    <Columns>
      <PageHeader title={t(locale, "orgs.title")} subtitle={`${orgs.length} ${t(locale, "directory.count")}`} back="/search" />
      <div className="space-y-3 border-b border-line p-4">
        <form className="flex gap-2">
          <div className="relative flex-1">
            <Search size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-faint" />
            <input name="q" defaultValue={q} placeholder={t(locale, "directory.search")} className="input pl-10" />
          </div>
          {type && <input type="hidden" name="type" value={type} />}
          <select name="region" defaultValue={region} className="input w-36 sm:w-44" aria-label={t(locale, "directory.allRegions")}>
            <option value="">{t(locale, "directory.allRegions")}</option>
            {REGIONS.map((r) => <option key={r} value={r}>{REGION_LABELS[locale][r]}</option>)}
          </select>
        </form>
        <div className="no-scrollbar -mx-4 flex gap-1.5 overflow-x-auto px-4">
          {["", ...ORG_TYPES].map((ty) => (
            <Link key={ty || "all"} href={typeHref(ty)} className={`shrink-0 rounded-full border px-3 py-1 text-[13px] font-medium transition ${type === ty ? "border-accent bg-accent-soft text-accent-ink" : "border-line text-muted hover:text-fg"}`}>
              {ty ? ORG_TYPE_LABELS[locale][ty] : t(locale, "directory.allTypes")}
            </Link>
          ))}
        </div>
      </div>
      {orgs.length === 0 && <EmptyState icon={Building2} title={t(locale, "orgs.empty")} />}
      <ul>
        {orgs.map((o) => (
          <li key={o.id}>
            <Link href={`/orgs/${o.slug}`} className="flex items-center gap-3.5 border-b border-line px-4 py-3 transition hover:bg-black/[0.03]">
              <OrgLogo slug={o.slug} name={o.name} size={44} />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold">{o.name}</span>
                <span className="block truncate text-[13px] text-faint">
                  {[ORG_TYPE_LABELS[locale][o.type], o.country, o.website.replace(/^https?:\/\/(www\.)?/, "")].filter(Boolean).join(" · ")}
                </span>
              </span>
              <span className="flex shrink-0 flex-col items-end gap-1 text-xs text-faint">
                {o.deals[0] && <span className="chip border-accent/40 text-accent-ink">{t(locale, "directory.inPipeline")}</span>}
                {o.followers.length > 0 && <span>{t(locale, "org.unfollow")}</span>}
              </span>
            </Link>
          </li>
        ))}
      </ul>
      <details className="m-4">
        <summary className="btn-secondary w-fit cursor-pointer list-none"><Plus size={16} /> {t(locale, "directory.add")}</summary>
        <form action={createOrgAction} className="card mt-3 grid gap-2 p-4 sm:grid-cols-2">
          <input name="name" required placeholder={t(locale, "org.name")} className="input" />
          <select name="type" className="input" defaultValue="fintech">
            {ORG_TYPES.map((ty) => <option key={ty} value={ty}>{ORG_TYPE_LABELS[locale][ty]}</option>)}
          </select>
          <input name="country" placeholder={`${t(locale, "org.country")} (ISO-2)`} maxLength={2} className="input" />
          <input name="website" placeholder="https://" className="input" />
          <button className="btn-primary sm:col-span-2">{t(locale, "org.create")}</button>
        </form>
      </details>
    </Columns>
  );
}
