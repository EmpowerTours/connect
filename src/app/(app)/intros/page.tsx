import Link from "next/link";
import { ArrowRight, Handshake, Inbox, Send } from "lucide-react";
import { respondIntroAction, withdrawIntroAction } from "@/app/actions";
import { UserAvatar } from "@/components/avatar";
import { avatarUrl } from "@/lib/media";
import { DemoBadge } from "@/components/badges";
import { EmptyState } from "@/components/empty-state";
import { Columns, PageHeader, Tabs } from "@/components/layout";
import { timeAgo } from "@/components/time";
import { getLocale, requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { t, type Locale } from "@/lib/i18n";
import type { IntroStatus } from "@/lib/intros";

export const dynamic = "force-dynamic";

const STATUS_STYLE: Record<IntroStatus, string> = {
  draft: "border-line-strong text-faint",
  pending: "border-amber-300 bg-amber-50 text-amber-800",
  accepted: "border-success/40 bg-success/10 text-success",
  declined: "border-danger/40 bg-danger/10 text-danger",
  withdrawn: "border-line text-faint",
};

function StatusPill({ status, locale }: { status: string; locale: Locale }) {
  const s = status as IntroStatus;
  return <span className={`chip ${STATUS_STYLE[s] ?? ""}`}>{t(locale, `introStatus.${s}`)}</span>;
}

type P = { id: string; name: string; handle: string; isDemo: boolean; headline: string; orgName: string; avatarKey: string | null };
const pSel = { id: true, name: true, handle: true, isDemo: true, headline: true, orgName: true, avatarKey: true } as const;

function Person({ p, locale, size = 36 }: { p: P; locale: Locale; size?: number }) {
  return (
    <Link href={`/u/${p.handle}`} className="flex min-w-0 items-center gap-2.5">
      <UserAvatar name={p.name} seed={p.handle} src={avatarUrl(p.avatarKey)} size={size} />
      <span className="min-w-0">
        <span className="flex items-center gap-1.5 text-[14px] font-semibold">
          <span className="truncate">{p.name}</span>
          {p.isDemo && <DemoBadge locale={locale} />}
        </span>
        <span className="block truncate text-xs text-faint">{[p.headline, p.orgName].filter(Boolean).join(" @ ")}</span>
      </span>
    </Link>
  );
}

export default async function IntrosPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const user = await requireUser();
  const locale = await getLocale();
  const raw = (await searchParams).tab;
  const tab = raw === "sent" || raw === "made" ? raw : "inbox";
  const include = { requester: { select: pSel }, connector: { select: pSel }, target: { select: pSel }, opportunity: { select: { id: true, headline: true, kind: true } } };
  const where =
    tab === "inbox"
      ? { OR: [{ connectorId: user.id, status: { not: "draft" } }, { targetId: user.id, status: "accepted", mode: "warm" }] }
      : tab === "sent"
        ? { requesterId: user.id, status: { not: "draft" } }
        : { connectorId: user.id, status: "accepted", mode: "warm" };
  const intros = await prisma.intro.findMany({ where, include, orderBy: [{ updatedAt: "desc" }] });
  intros.sort((a, b) => Number(b.status === "pending") - Number(a.status === "pending"));
  const pending = await prisma.intro.count({ where: { connectorId: user.id, status: "pending" } });

  return (
    <Columns>
      <PageHeader title={t(locale, "nav.intros")} subtitle={t(locale, "intros.subtitle")}>
        <Tabs
          tabs={[
            { href: "/intros", label: <>{t(locale, "intros.inbox")}{pending > 0 && <span className="ml-1.5 rounded-full bg-accent px-1.5 text-xs font-bold text-white">{pending}</span>}</>, active: tab === "inbox" },
            { href: "/intros?tab=sent", label: t(locale, "intros.sent"), active: tab === "sent" },
            { href: "/intros?tab=made", label: t(locale, "intros.made"), active: tab === "made" },
          ]}
        />
      </PageHeader>
      {intros.length === 0 && (
        <EmptyState
          icon={tab === "sent" ? Send : tab === "made" ? Handshake : Inbox}
          title={t(locale, `intros.empty.${tab}`)}
          body={t(locale, "intros.emptyBody")}
          action={<Link href="/" className="btn-secondary">{t(locale, "intros.browse")}</Link>}
        />
      )}
      <ul>
        {intros.map((i) => {
          const direct = i.mode === "direct";
          const iAmConnector = i.connectorId === user.id;
          const iAmTarget = i.targetId === user.id && !direct;
          return (
            <li key={i.id} className="border-b border-line px-4 py-4 animate-fade-in">
              <div className="mb-3 flex items-center justify-between gap-2">
                <p className="text-[13px] text-faint">
                  {direct
                    ? iAmConnector
                      ? t(locale, "intros.directAsksYou").replace("{name}", i.requester.name)
                      : t(locale, "intros.youAskedDirect").replace("{name}", i.target.name)
                    : iAmTarget
                    ? t(locale, "intros.introducedYou").replace("{name}", i.connector.name)
                    : iAmConnector
                      ? t(locale, "intros.asksYou").replace("{name}", i.requester.name)
                      : t(locale, "intros.youAsked").replace("{name}", i.connector.name)}{" "}
                  · {timeAgo(i.createdAt, locale)}
                </p>
                <StatusPill status={i.status} locale={locale} />
              </div>
              <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 rounded-2xl border border-line bg-raised/60 p-3">
                <Person p={i.requester} locale={locale} />
                <span className="flex flex-col items-center px-1 text-faint">
                  {!direct && <UserAvatar name={i.connector.name} seed={i.connector.handle} src={avatarUrl(i.connector.avatarKey)} size={22} />}
                  <ArrowRight size={14} className="mt-0.5" />
                </span>
                <Person p={i.target} locale={locale} />
              </div>
              {i.opportunity && (
                <Link href={`/opportunities/${i.opportunity.id}`} className="mt-2 flex items-center gap-2 rounded-xl bg-accent-soft/60 px-3 py-2 text-[13px] text-accent-ink hover:bg-accent-soft">
                  <span className="shrink-0 text-[11px] font-semibold uppercase tracking-[0.1em]">{t(locale, i.opportunity.kind === "offer" ? "opps.offer" : "opps.ask")}</span>
                  <span className="truncate font-medium">{i.opportunity.headline}</span>
                </Link>
              )}
              {i.reason && (
                <p className="mt-3 text-[14px] text-muted">
                  <span className="font-medium text-fg">{t(locale, "intros.why")}:</span> {i.reason}
                </p>
              )}
              {!direct && (iAmConnector || i.requesterId === user.id) && i.message && (
                <details className="mt-2 text-[14px]" open={iAmConnector && i.status === "pending"}>
                  <summary className="cursor-pointer text-sm text-accent">{t(locale, "intros.message")}</summary>
                  <p className="mt-2 whitespace-pre-wrap rounded-xl border border-line bg-surface p-3 text-fg/90">{i.message}</p>
                </details>
              )}
              {i.connectorNote && i.status !== "pending" && (
                <blockquote className="mt-3 border-l-2 border-accent pl-3 text-[14px] text-fg/90">
                  <span className="block text-xs text-faint">{i.status === "accepted" ? t(locale, "intros.forwardedNote") : t(locale, "intros.declineNote")}</span>
                  {i.connectorNote}
                </blockquote>
              )}
              {iAmConnector && i.status === "pending" && (
                <form action={respondIntroAction} className="mt-3 space-y-2">
                  <input type="hidden" name="introId" value={i.id} />
                  <textarea name="note" rows={2} className="input text-[14px]" placeholder={t(locale, direct ? "intros.directNotePh" : "intros.notePlaceholder").replace("{name}", (direct ? i.requester : i.target).name.split(" ")[0])} />
                  <div className="flex gap-2">
                    <button name="decision" value="accept" className="btn-primary">{t(locale, "intros.accept")}</button>
                    <button name="decision" value="decline" className="btn-secondary">{t(locale, "intros.decline")}</button>
                  </div>
                </form>
              )}
              {i.requesterId === user.id && i.status === "pending" && (
                <form action={withdrawIntroAction} className="mt-3">
                  <input type="hidden" name="introId" value={i.id} />
                  <button className="btn-ghost h-8 px-3 text-xs">{t(locale, "intros.withdraw")}</button>
                </form>
              )}
            </li>
          );
        })}
      </ul>
    </Columns>
  );
}
