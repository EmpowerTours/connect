import Link from "next/link";
import { Building2, Check, ExternalLink, Inbox, ShieldCheck, X } from "lucide-react";
import { adminDecideClaimAction, adminDecideOrgRequestAction } from "@/app/claim-actions";
import { UserAvatar } from "@/components/avatar";
import { EmptyState } from "@/components/empty-state";
import { TabPage } from "@/components/layout";
import { SubmitButton } from "@/components/submit-button";
import { timeAgo } from "@/components/time";
import { VerifiedOnMonad } from "@/components/wallet-badge";
import { getLocale, requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { ORG_TYPE_LABELS, t, type Locale } from "@/lib/i18n";
import { linkLabel } from "@/lib/links";

export const dynamic = "force-dynamic";
export const metadata = { title: "Admin" };

type Tab = "claims" | "orgs";

export default async function AdminPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  await requireAdmin();
  const locale = await getLocale();
  const raw = (await searchParams).tab;
  const tab: Tab = raw === "orgs" ? "orgs" : "claims";
  const userSel = { id: true, name: true, handle: true, headline: true, walletVerified: true, walletAddress: true } as const;
  const [claims, requests, counts] = await Promise.all([
    tab === "claims"
      ? prisma.orgClaim.findMany({ where: { status: "pending" }, include: { user: { select: userSel }, org: { select: { name: true, slug: true, website: true } } }, orderBy: { createdAt: "asc" } })
      : Promise.resolve([]),
    tab === "orgs" ? prisma.orgRequest.findMany({ where: { status: "pending" }, include: { user: { select: userSel } }, orderBy: { createdAt: "asc" } }) : Promise.resolve([]),
    Promise.all([prisma.orgClaim.count({ where: { status: "pending" } }), prisma.orgRequest.count({ where: { status: "pending" } })]),
  ]);
  const tabs: { key: Tab; label: string; n: number }[] = [
    { key: "claims", label: t(locale, "admin.claims"), n: counts[0] },
    { key: "orgs", label: t(locale, "admin.orgRequests"), n: counts[1] },
  ];

  return (
    <TabPage>
      <p className="eyebrow flex h-10 items-center gap-1.5"><ShieldCheck size={13} /> {t(locale, "admin.eyebrow")}</p>
      <h1 className="mt-1 text-[30px] font-semibold leading-tight tracking-[-0.02em]">{t(locale, "admin.title")}</h1>
      <p className="mt-1 text-[14px] text-muted">{t(locale, "admin.subtitle")}</p>

      <nav className="mt-5 inline-flex rounded-full border border-white/80 bg-white/60 p-1" aria-label="Admin sections">
        {tabs.map((x) => (
          <Link
            key={x.key}
            href={x.key === "claims" ? "/admin" : `/admin?tab=${x.key}`}
            className={`inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 text-[13px] font-semibold transition ${tab === x.key ? "bg-white text-accent-ink shadow-[0_1px_3px_rgb(23_21_31/0.08)]" : "text-faint hover:text-fg"}`}
          >
            {x.label}
            {x.n > 0 && <span className="rounded-full bg-accent px-1.5 text-[11px] font-bold text-white">{x.n}</span>}
          </Link>
        ))}
      </nav>

      {tab === "claims" &&
        (claims.length === 0 ? (
          <EmptyState icon={Inbox} title={t(locale, "admin.noClaims")} body={t(locale, "admin.noClaimsBody")} />
        ) : (
          <ul className="mt-4 space-y-3">
            {claims.map((c) => (
              <li key={c.id} className="glass p-4">
                <div className="flex items-start gap-3">
                  <UserAvatar name={c.user.name} seed={c.user.handle} size={44} />
                  <div className="min-w-0 flex-1">
                    <p className="text-[15px] font-semibold leading-snug">
                      <Link href={`/u/${c.user.handle}`} className="hover:underline">{c.user.name}</Link>
                      <span className="font-normal text-faint"> {t(locale, "admin.claimsTo")} </span>
                      <Link href={`/orgs/${c.org.slug}`} className="text-accent-ink hover:underline">{c.org.name}</Link>
                    </p>
                    <p className="mt-0.5 text-[13px] text-faint">@{c.user.handle} · {timeAgo(c.createdAt, locale)}</p>
                    <div className="mt-2"><VerifiedOnMonad user={c.user} locale={locale} size="sm" /></div>
                  </div>
                </div>
                <dl className="mt-3 space-y-1.5 rounded-2xl bg-raised/70 p-3 text-[13px]">
                  <Row label={t(locale, "claims.title")} value={c.title || "—"} />
                  <Row
                    label={t(locale, "claims.evidence")}
                    value={c.evidenceUrl ? <a href={c.evidenceUrl} target="_blank" rel="noreferrer nofollow" className="inline-flex items-center gap-1 text-accent hover:underline">{linkLabel(c.evidenceUrl)} <ExternalLink size={11} /></a> : "—"}
                  />
                  {c.org.website && <Row label={t(locale, "org.website")} value={linkLabel(c.org.website)} />}
                  {c.note && <Row label={t(locale, "claims.note")} value={c.note} />}
                </dl>
                <Decide action={adminDecideClaimAction} idName="claimId" id={c.id} locale={locale} />
              </li>
            ))}
          </ul>
        ))}

      {tab === "orgs" &&
        (requests.length === 0 ? (
          <EmptyState icon={Building2} title={t(locale, "admin.noRequests")} body={t(locale, "admin.noRequestsBody")} />
        ) : (
          <ul className="mt-4 space-y-3">
            {requests.map((r) => (
              <li key={r.id} className="glass p-4">
                <p className="text-[15px] font-semibold">{r.name}</p>
                <p className="mt-0.5 text-[13px] text-faint">
                  {ORG_TYPE_LABELS[locale][r.type] ?? r.type} · {t(locale, "admin.requestedBy")} <Link href={`/u/${r.user.handle}`} className="text-accent-ink hover:underline">{r.user.name}</Link> · {timeAgo(r.createdAt, locale)}
                </p>
                {r.website && <a href={r.website} target="_blank" rel="noreferrer nofollow" className="mt-1 inline-flex items-center gap-1 text-[13px] text-accent hover:underline">{linkLabel(r.website)} <ExternalLink size={11} /></a>}
                {r.note && <p className="mt-2 text-[13px] text-muted">{r.note}</p>}
                <Decide action={adminDecideOrgRequestAction} idName="requestId" id={r.id} locale={locale} />
              </li>
            ))}
          </ul>
        ))}
      <p className="mt-8 px-1 text-center text-[11.5px] text-faint">{t(locale, "admin.footer")}</p>
    </TabPage>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[96px_1fr] gap-2">
      <dt className="text-faint">{label}</dt>
      <dd className="min-w-0 break-words text-fg/90">{value}</dd>
    </div>
  );
}

function Decide({ action, idName, id, locale }: { action: (fd: FormData) => Promise<void>; idName: string; id: string; locale: Locale }) {
  return (
    <div className="mt-3 grid grid-cols-2 gap-2">
      <form action={action}>
        <input type="hidden" name={idName} value={id} />
        <input type="hidden" name="decision" value="reject" />
        <SubmitButton className="btn-secondary h-10 w-full text-[13px]"><X size={15} /> {t(locale, "admin.reject")}</SubmitButton>
      </form>
      <form action={action}>
        <input type="hidden" name={idName} value={id} />
        <input type="hidden" name="decision" value="approve" />
        <SubmitButton className="btn-primary h-10 w-full text-[13px]"><Check size={15} /> {t(locale, "admin.approve")}</SubmitButton>
      </form>
    </div>
  );
}
