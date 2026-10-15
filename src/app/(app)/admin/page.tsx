import Link from "next/link";
import { Building2, Check, EyeOff, ExternalLink, Flag, Inbox, ShieldCheck, X } from "lucide-react";
import { adminDecideClaimAction, adminDecideOrgRequestAction } from "@/app/claim-actions";
import { adminDecideReportAction, adminSetOpportunityHiddenAction } from "@/app/moderation-actions";
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
import { avatarUrl } from "@/lib/media";
import { isReportReason } from "@/lib/opportunities";

export const dynamic = "force-dynamic";
export const metadata = { title: "Admin" };

type Tab = "claims" | "orgs" | "reports";

export default async function AdminPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  await requireAdmin();
  const locale = await getLocale();
  const raw = (await searchParams).tab;
  const tab: Tab = raw === "orgs" || raw === "reports" ? raw : "claims";
  const userSel = { id: true, name: true, handle: true, headline: true, avatarKey: true, walletVerified: true, walletAddress: true } as const;
  const [claims, requests, counts] = await Promise.all([
    tab === "claims"
      ? prisma.orgClaim.findMany({ where: { status: "pending" }, include: { user: { select: userSel }, org: { select: { name: true, slug: true, website: true } } }, orderBy: { createdAt: "asc" } })
      : Promise.resolve([]),
    tab === "orgs" ? prisma.orgRequest.findMany({ where: { status: "pending" }, include: { user: { select: userSel } }, orderBy: { createdAt: "asc" } }) : Promise.resolve([]),
    Promise.all([
      prisma.orgClaim.count({ where: { status: "pending" } }),
      prisma.orgRequest.count({ where: { status: "pending" } }),
      prisma.report.groupBy({ by: ["targetType", "targetId"], where: { status: "open" } }).then((g) => g.length),
    ]),
  ]);
  const reported = tab === "reports" ? await loadReports() : { groups: [], hidden: [] };
  const tabs: { key: Tab; label: string; n: number }[] = [
    { key: "claims", label: t(locale, "admin.claims"), n: counts[0] },
    { key: "orgs", label: t(locale, "admin.orgRequests"), n: counts[1] },
    { key: "reports", label: t(locale, "admin.reports"), n: counts[2] },
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
                  <UserAvatar name={c.user.name} seed={c.user.handle} src={avatarUrl(c.user.avatarKey)} size={44} />
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
                  <Row label={t(locale, "admin.role")} value={c.title || "—"} />
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
      {tab === "reports" && (
        <>
          {reported.groups.length === 0 ? (
            <EmptyState icon={Flag} title={t(locale, "admin.noReports")} body={t(locale, "admin.noReportsBody")} />
          ) : (
            <ul className="mt-4 space-y-3">
              {reported.groups.map(({ opp, reports }) => (
                <li key={opp.id} className="glass p-4">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-accent-ink">{t(locale, opp.kind === "offer" ? "opps.offer" : "opps.ask")}</p>
                  <Link href={`/opportunities/${opp.id}`} className="mt-0.5 block text-[15.5px] font-semibold leading-snug hover:underline">{opp.headline}</Link>
                  <p className="mt-0.5 text-[13px] text-faint">
                    {t(locale, "admin.postBy")} <Link href={`/u/${opp.author.handle}`} className="text-accent-ink hover:underline">{opp.author.name}</Link> · {timeAgo(opp.createdAt, locale)}
                  </p>
                  {opp.body && <p className="mt-2 line-clamp-3 text-[13.5px] text-muted">{opp.body}</p>}
                  <ul className="mt-3 space-y-1.5 rounded-2xl bg-raised/70 p-3 text-[13px]">
                    {reports.map((r) => (
                      <li key={r.id}>
                        <span className="font-semibold">{isReportReason(r.reason) ? t(locale, `report.${r.reason}`) : r.reason}</span>
                        <span className="text-faint"> · {t(locale, "admin.reportedBy")} @{r.reporter.handle} · {timeAgo(r.createdAt, locale)}</span>
                        {r.note && <span className="block text-fg/85">{r.note}</span>}
                      </li>
                    ))}
                  </ul>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <form action={adminDecideReportAction}>
                      <input type="hidden" name="reportId" value={reports[0].id} />
                      <input type="hidden" name="decision" value="dismiss" />
                      <SubmitButton className="btn-secondary h-10 w-full text-[13px]"><X size={15} /> {t(locale, "admin.dismiss")}</SubmitButton>
                    </form>
                    <form action={adminDecideReportAction}>
                      <input type="hidden" name="reportId" value={reports[0].id} />
                      <input type="hidden" name="decision" value="hide" />
                      <SubmitButton className="btn-primary h-10 w-full text-[13px]"><EyeOff size={15} /> {t(locale, "admin.hide")}</SubmitButton>
                    </form>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {reported.hidden.length > 0 && (
            <section className="mt-6">
              <h2 className="eyebrow mb-2">{t(locale, "admin.hidden")}</h2>
              <ul className="space-y-2">
                {reported.hidden.map((o) => (
                  <li key={o.id} className="card flex items-center justify-between gap-3 px-4 py-3">
                    <Link href={`/opportunities/${o.id}`} className="min-w-0 truncate text-[14px] font-medium hover:underline">{o.headline}</Link>
                    <form action={adminSetOpportunityHiddenAction}>
                      <input type="hidden" name="id" value={o.id} />
                      <input type="hidden" name="hidden" value="0" />
                      <SubmitButton className="btn-ghost h-8 shrink-0 text-[12.5px]">{t(locale, "admin.unhide")}</SubmitButton>
                    </form>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
      <p className="mt-8 px-1 text-center text-[11.5px] text-faint">{t(locale, "admin.footer")}</p>
    </TabPage>
  );
}

async function loadReports() {
  const open = await prisma.report.findMany({
    where: { status: "open", targetType: "opportunity" },
    include: { reporter: { select: { handle: true } } },
    orderBy: { createdAt: "asc" },
  });
  const ids = [...new Set(open.map((r) => r.targetId))];
  const [opps, hidden] = await Promise.all([
    prisma.opportunity.findMany({ where: { id: { in: ids } }, include: { author: { select: { name: true, handle: true } } } }),
    prisma.opportunity.findMany({ where: { hidden: true }, select: { id: true, headline: true }, orderBy: { updatedAt: "desc" }, take: 20 }),
  ]);
  const byId = new Map(opps.map((o) => [o.id, o]));
  const groups = ids.flatMap((id) => {
    const opp = byId.get(id);
    return opp ? [{ opp, reports: open.filter((r) => r.targetId === id) }] : [];
  });
  return { groups, hidden };
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
