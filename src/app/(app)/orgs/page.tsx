import Link from "next/link";
import { Building2, Clock, Plus, Search } from "lucide-react";
import { requestOrgAction, updateOrgRequestAction } from "@/app/claim-actions";
import { OrgLogo } from "@/components/avatar";
import { EmptyState } from "@/components/empty-state";
import { Columns, PageHeader } from "@/components/layout";
import { PhotoPicker } from "@/components/photo-picker";
import { SubmitButton } from "@/components/submit-button";
import { getLocale, getWorkspace, requireUser } from "@/lib/auth";
import { ORG_TYPES, REGIONS } from "@/lib/constants";
import { prisma } from "@/lib/db";
import { ORG_TYPE_LABELS, REGION_LABELS, t, type Locale, type MessageKey } from "@/lib/i18n";
import { avatarUrl } from "@/lib/media";
import { isOnboardingError } from "@/lib/onboarding";

export const dynamic = "force-dynamic";

type Search = { q?: string; type?: string; region?: string; orgError?: string; orgSlug?: string; orgRequested?: string; reqError?: string; reqSaved?: string };

const ORG_ERRORS = new Set(["exists", "name_empty", "name_long", "website", "type", "not_yours", "not_pending", "not_found"]);

/** Error code from an org-request redirect -> message (codes are whitelisted, never echoed). */
function orgErrorText(locale: Locale, code: string | undefined): string | null {
  if (!code) return null;
  if (code.startsWith("photo_") && isOnboardingError(code)) return t(locale, `onb.err.${code}`);
  return t(locale, (ORG_ERRORS.has(code) ? `orgs.err.${code}` : "orgs.err.generic") as MessageKey);
}

export default async function OrgsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await requireUser();
  const locale = await getLocale();
  const ws = await getWorkspace(user.id);
  const sp = await searchParams;
  const { q = "", type = "", region = "" } = sp;
  const myRequests = await prisma.orgRequest.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 10 });
  const approvedSlugs = new Map(
    (await prisma.organization.findMany({ where: { id: { in: myRequests.flatMap((r) => (r.orgId ? [r.orgId] : [])) } }, select: { id: true, slug: true } })).map((o) => [o.id, o.slug]),
  );
  const addError = orgErrorText(locale, sp.orgError);
  const reqError = orgErrorText(locale, sp.reqError);
  const existingSlug = sp.orgError === "exists" && sp.orgSlug && /^[a-z0-9-]{1,100}$/.test(sp.orgSlug) ? sp.orgSlug : null;
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
              <OrgLogo slug={o.slug} name={o.name} size={44} src={avatarUrl(o.logoKey)} />
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
      {myRequests.length > 0 && (
        <section id="my-requests" className="m-4 scroll-mt-20" data-testid="my-org-requests">
          <h2 className="eyebrow mb-2">{t(locale, "orgs.mine")}</h2>
          {sp.orgRequested && <p role="status" className="mb-2 rounded-xl bg-accent-soft p-3 text-sm font-medium text-accent-ink">{t(locale, "orgs.request.sent")}</p>}
          {sp.reqSaved && <p role="status" className="mb-2 rounded-xl bg-accent-soft p-3 text-sm font-medium text-accent-ink">{t(locale, "orgs.request.saved")}</p>}
          {reqError && <p role="alert" className="mb-2 rounded-xl bg-danger/10 p-3 text-sm text-danger">{reqError}</p>}
          <ul className="space-y-2.5">
            {myRequests.map((r) => {
              const slug = r.orgId ? approvedSlugs.get(r.orgId) : undefined;
              const logo = avatarUrl(r.logoKey);
              return (
                <li key={r.id} className="card p-3.5" data-testid="org-request">
                  <div className="flex items-center gap-3">
                    <OrgLogo slug={slug ?? ""} name={r.name} size={44} src={logo} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold">{r.name}</span>
                      <span className="block truncate text-[13px] text-faint">{[ORG_TYPE_LABELS[locale][r.type] ?? r.type, r.website.replace(/^https?:\/\/(www\.)?/, "")].filter(Boolean).join(" · ")}</span>
                    </span>
                    <span className={`chip shrink-0 ${r.status === "pending" ? "border-accent/40 text-accent-ink" : ""}`}>
                      {r.status === "pending" && <Clock size={12} />}
                      {t(locale, r.status === "approved" ? "orgs.mine.approved" : r.status === "rejected" ? "orgs.mine.rejected" : "orgs.mine.pending")}
                    </span>
                  </div>
                  {slug && <Link href={`/orgs/${slug}`} className="mt-2 inline-block text-[13px] font-semibold text-accent hover:underline">{t(locale, "orgs.mine.open")}</Link>}
                  {r.status === "pending" && (
                    <details className="mt-3" open={!!sp.reqError}>
                      <summary className="cursor-pointer text-[13px] font-semibold text-accent">{t(locale, "orgs.mine.edit")}</summary>
                      <form action={updateOrgRequestAction} className="mt-3 space-y-3" data-testid="org-request-edit">
                        <input type="hidden" name="requestId" value={r.id} />
                        <PhotoPicker square current={logo} fallback={<OrgLogo slug="" name={r.name} size={84} />} label={t(locale, "orgs.request.logo")} hint={t(locale, "orgs.request.logoHint")} />
                        {r.logoKey && (
                          <label className="flex items-center gap-2 text-[13px] text-muted">
                            <input type="checkbox" name="removeLogo" className="h-4 w-4 accent-[#7c3aed]" /> {t(locale, "orgs.mine.removeLogo")}
                          </label>
                        )}
                        <OrgFields locale={locale} values={r} />
                        <SubmitButton className="btn-primary w-full">{t(locale, "orgs.mine.save")}</SubmitButton>
                      </form>
                    </details>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}
      <details id="add-org" className="m-4 scroll-mt-20" open={!!sp.orgError}>
        <summary className="btn-secondary w-fit cursor-pointer list-none"><Plus size={16} /> {t(locale, "directory.add")}</summary>
        <form action={requestOrgAction} className="card mt-3 space-y-3 p-4" data-testid="org-request-form">
          <input type="hidden" name="back" value="/orgs" />
          <div>
            <h2 className="font-semibold">{t(locale, "orgs.request.title")}</h2>
            <p className="mt-0.5 text-[13px] leading-snug text-muted">{t(locale, "orgs.request.body")}</p>
          </div>
          {addError && (
            <p role="alert" className="rounded-xl bg-danger/10 p-3 text-sm text-danger">
              {addError}
              {existingSlug && <> <Link href={`/orgs/${existingSlug}`} className="font-semibold underline">{t(locale, "orgs.err.existsLink")}</Link></>}
            </p>
          )}
          <PhotoPicker square current={null} fallback={<OrgLogo slug="" name="+" size={84} />} label={t(locale, "orgs.request.logo")} hint={t(locale, "orgs.request.logoHint")} />
          <OrgFields locale={locale} values={null} />
          <SubmitButton className="btn-primary w-full">{t(locale, "orgs.request.submit")}</SubmitButton>
        </form>
      </details>
    </Columns>
  );
}

/** Name, type, website and reviewer note: shared by the add form and the edit-request form. */
function OrgFields({ locale, values }: { locale: Locale; values: { name: string; type: string; website: string; note: string } | null }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <input name="name" required maxLength={80} defaultValue={values?.name} placeholder={t(locale, "org.name")} aria-label={t(locale, "org.name")} className="input" />
      <select name="type" className="input" defaultValue={values?.type || "fintech"} aria-label={t(locale, "org.type")}>
        {ORG_TYPES.map((ty) => <option key={ty} value={ty}>{ORG_TYPE_LABELS[locale][ty]}</option>)}
      </select>
      <input name="website" maxLength={300} defaultValue={values?.website} placeholder="https://" aria-label={t(locale, "org.website")} className="input sm:col-span-2" />
      <textarea name="note" maxLength={500} rows={2} defaultValue={values?.note} placeholder={t(locale, "orgs.request.note")} aria-label={t(locale, "orgs.request.note")} className="input sm:col-span-2" />
    </div>
  );
}
