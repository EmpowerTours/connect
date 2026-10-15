import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CalendarClock, Check, CircleCheck, EyeOff, Flag, Handshake, Pencil, RotateCcw, Send, X } from "lucide-react";
import { adminSetOpportunityHiddenAction } from "@/app/moderation-actions";
import {
  reportOpportunityAction,
  requestDirectIntroAction,
  setOpportunityStatusAction,
  updateOpportunityAction,
} from "@/app/opportunity-actions";
import { UserAvatar } from "@/components/avatar";
import { DemoBadge } from "@/components/badges";
import { TabPage } from "@/components/layout";
import { OpportunityFields, opportunityErrorKey } from "@/components/opportunity-form";
import { SubmitButton } from "@/components/submit-button";
import { timeAgo } from "@/components/time";
import { VerifiedOnMonad } from "@/components/wallet-badge";
import { currentUserIsAdmin, getLocale, requireUser } from "@/lib/auth";
import { warmPath } from "@/lib/circle";
import { prisma } from "@/lib/db";
import { REGION_LABELS, t, type Locale } from "@/lib/i18n";
import { avatarUrl } from "@/lib/media";
import { isFocusTag } from "@/lib/onboarding";
import { INTRO_REASON_MAX, REPORT_REASONS, displayState } from "@/lib/opportunities";

export const dynamic = "force-dynamic";

const INTRO_ERRORS = ["self", "not_live", "connected", "duplicate", "reason_empty", "reason_long"] as const;
const REPORT_ERRORS = ["self", "reason", "note_long"] as const;
const pick = <T extends string>(list: readonly T[], v?: string): T | null => (v && (list as readonly string[]).includes(v) ? (v as T) : null);

export default async function OpportunityPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await requireUser();
  const locale = await getLocale();
  const [{ id }, sp, admin] = await Promise.all([params, searchParams, currentUserIsAdmin()]);
  const o = await prisma.opportunity.findUnique({
    where: { id },
    include: {
      author: { select: { id: true, name: true, handle: true, headline: true, orgName: true, isDemo: true, avatarKey: true, walletVerified: true, walletAddress: true } },
    },
  });
  const isMine = o?.authorId === user.id;
  if (!o || (o.hidden && !isMine && !admin)) notFound();
  const now = new Date();
  const state = displayState(o, now);
  const live = state === "live";

  const [edges, myIntro, myReport, introCount] = await Promise.all([
    isMine ? Promise.resolve([]) : prisma.followUser.findMany({ select: { followerId: true, followeeId: true } }),
    isMine ? Promise.resolve(null) : prisma.intro.findFirst({ where: { requesterId: user.id, targetId: o.authorId, status: { in: ["pending", "accepted"] } }, orderBy: { createdAt: "desc" } }),
    isMine ? Promise.resolve(null) : prisma.report.findUnique({ where: { reporterId_targetType_targetId: { reporterId: user.id, targetType: "opportunity", targetId: o.id } } }),
    isMine ? prisma.intro.count({ where: { opportunityId: o.id, status: { not: "draft" } } }) : Promise.resolve(0),
  ]);
  const path = isMine ? null : warmPath(edges, user.id, o.authorId);
  const via = path?.length === 3 ? await prisma.user.findUnique({ where: { id: path[1] }, select: { name: true, handle: true } }) : null;
  const connected = path?.length === 2;

  const ask = o.kind === "ask";
  const first = o.author.name.split(" ")[0];
  const editing = isMine && sp.edit === "1" && o.status === "open" && !o.hidden;
  const errKey = opportunityErrorKey(sp.error);
  const introErr = pick(INTRO_ERRORS, sp.introError);
  const reportErr = pick(REPORT_ERRORS, sp.reportError);
  const banner = sp.posted ? "opps.posted" : sp.saved ? "opps.saved" : sp.requested ? "opps.requested" : sp.reported ? "opps.reported" : null;
  const days = o.expiresAt ? Math.max(0, Math.ceil((o.expiresAt.getTime() - now.getTime()) / 86_400_000)) : null;

  return (
    <TabPage>
      <div className="flex h-10 items-center">
        <Link href={isMine ? "/opportunities?mine=1" : "/opportunities"} className="-ml-2 inline-flex h-9 items-center gap-1 rounded-full px-2 text-[14px] font-medium text-muted hover:text-fg">
          <ArrowLeft size={18} /> {t(locale, "nav.opportunities")}
        </Link>
      </div>

      {banner && <p role="status" className="mt-2 flex items-center gap-2 rounded-2xl bg-accent-soft px-4 py-3 text-[14px] font-medium text-accent-ink"><CircleCheck size={17} /> {t(locale, banner)}</p>}
      {errKey && <p role="alert" className="mt-2 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{t(locale, errKey)}</p>}
      {o.hidden && <p className="mt-2 flex items-center gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-[13.5px] text-amber-900"><EyeOff size={16} /> {t(locale, "opps.hiddenNote")}</p>}

      {editing ? (
        <section className="glass mt-3 p-5">
          <h1 className="text-[20px] font-semibold tracking-tight">{t(locale, "opps.edit")}</h1>
          <form action={updateOpportunityAction} className="mt-4 space-y-4">
            <input type="hidden" name="id" value={o.id} />
            <OpportunityFields locale={locale} d={{ kind: o.kind, headline: o.headline, body: o.body, region: o.region, topic: o.topic, orgName: o.orgName }} editing showOrg={false} />
            <div className="grid grid-cols-2 gap-2">
              <Link href={`/opportunities/${o.id}`} className="btn-secondary h-11">{t(locale, "opps.cancel")}</Link>
              <SubmitButton className="btn-primary h-11">{t(locale, "opps.saveChanges")}</SubmitButton>
            </div>
          </form>
        </section>
      ) : (
        <article
          className="mt-3 rounded-[28px] border border-white/90 p-5 shadow-[0_1px_2px_rgb(23_21_31/0.04),0_14px_36px_-18px_rgb(76_29_149/0.3)]"
          style={{ background: ask ? "linear-gradient(160deg, rgb(243 238 255 / 0.97) 0%, rgb(255 255 255 / 0.94) 70%)" : "linear-gradient(160deg, rgb(255 255 255 / 0.97) 0%, rgb(248 246 252 / 0.94) 100%)" }}
        >
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em]">
            <span className={ask ? "text-accent-ink" : "text-faint"}>{t(locale, ask ? "opps.ask" : "opps.offer")}</span>
            {state !== "live" && <span className="rounded-full bg-zinc-900/80 px-2 py-0.5 text-[10.5px] tracking-[0.08em] text-white">{t(locale, `opps.state.${state}`)}</span>}
          </div>
          <h1 className="mt-1.5 text-[23px] font-semibold leading-[1.2] tracking-[-0.015em] text-balance">{o.headline}</h1>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {o.topic && isFocusTag(o.topic) && <span className="rounded-full bg-accent-soft px-2.5 py-0.5 text-[12px] font-medium text-accent-ink">{t(locale, `focus.${o.topic}`)}</span>}
            {o.region && <span className="rounded-full border border-line bg-white/80 px-2.5 py-0.5 text-[12px] font-medium text-muted">{REGION_LABELS[locale][o.region] ?? o.region}</span>}
            {o.orgName && <span className="rounded-full border border-line bg-white/80 px-2.5 py-0.5 text-[12px] font-medium text-muted">{o.orgName}</span>}
          </div>
          {o.body && <p className="mt-3 whitespace-pre-wrap text-[15px] leading-relaxed text-fg/85">{o.body}</p>}

          <Link href={`/u/${o.author.handle}`} className="mt-5 flex items-center gap-3 rounded-2xl bg-white/70 p-3 transition hover:bg-white">
            <UserAvatar name={o.author.name} seed={o.author.handle} src={avatarUrl(o.author.avatarKey)} size={42} />
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5 text-[14.5px] font-semibold">
                <span className="truncate">{o.author.name}</span>
                {o.author.isDemo && <DemoBadge locale={locale} />}
              </span>
              <span className="block truncate text-[12.5px] text-faint">{[o.author.headline, o.author.orgName].filter(Boolean).join(" @ ")}</span>
            </span>
            <VerifiedOnMonad user={o.author} locale={locale} size="sm" />
          </Link>
          <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-faint">
            <span>{t(locale, "opps.postedAgo").replace("{ago}", timeAgo(o.createdAt, locale))}</span>
            {live && days !== null && (
              <span className="inline-flex items-center gap-1"><CalendarClock size={13} /> {t(locale, days <= 1 ? "opps.expiresSoon" : "opps.expiresIn").replace("{n}", String(days))}</span>
            )}
          </p>
        </article>
      )}

      {isMine && !editing && (
        <section className="glass mt-4 p-4">
          <h2 className="text-[15px] font-semibold">{t(locale, "opps.manage")}</h2>
          <p className="mt-0.5 text-[13px] text-muted">
            {introCount > 0 ? (
              <Link href="/intros" className="text-accent-ink hover:underline">{t(locale, "opps.introCount").replace("{n}", String(introCount))}</Link>
            ) : (
              t(locale, "opps.noIntrosYet")
            )}
          </p>
          {!o.hidden && (
            <div className="mt-3 grid grid-cols-3 gap-2">
              {live ? (
                <>
                  <Link href={`/opportunities/${o.id}?edit=1`} className="btn-secondary h-10 text-[13px]"><Pencil size={14} /> {t(locale, "opps.editShort")}</Link>
                  <StatusButton id={o.id} action="fill" icon={<Check size={14} />} label={t(locale, "opps.markFilled")} primary />
                  <StatusButton id={o.id} action="close" icon={<X size={14} />} label={t(locale, "opps.close")} />
                </>
              ) : (
                <div className="col-span-3"><StatusButton id={o.id} action="reopen" icon={<RotateCcw size={14} />} label={t(locale, "opps.reopen")} primary /></div>
              )}
            </div>
          )}
        </section>
      )}

      {!isMine && (
        <section id="intro" className="glass mt-4 scroll-mt-6 p-4">
          <h2 className="flex items-center gap-2 text-[15px] font-semibold"><Handshake size={17} className="text-accent" /> {t(locale, "opps.introTitle").replace("{name}", first)}</h2>
          {connected ? (
            <p className="mt-1.5 text-[13.5px] text-muted">{t(locale, "opps.alreadyConnected").replace("{name}", first)} <Link href={`/u/${o.author.handle}`} className="font-medium text-accent-ink hover:underline">{t(locale, "opps.viewProfile")}</Link></p>
          ) : myIntro ? (
            <p className="mt-1.5 text-[13.5px] text-muted">
              {t(locale, myIntro.status === "accepted" ? "opps.introAccepted" : "opps.introPending").replace("{name}", first)}{" "}
              <Link href="/intros?tab=sent" className="font-medium text-accent-ink hover:underline">{t(locale, "opps.seeIntros")}</Link>
            </p>
          ) : !live ? (
            <p className="mt-1.5 text-[13.5px] text-muted">{t(locale, "opps.notLive")}</p>
          ) : (
            <>
              {via && (
                <Link href={`/u/${o.author.handle}?intro=1&via=${via.handle}`} className="mt-3 flex items-center justify-between gap-2 rounded-2xl border border-lilac/70 bg-accent-soft/60 px-3.5 py-3 text-[13.5px] font-medium text-accent-ink">
                  <span>{t(locale, "opps.warmVia").replace("{name}", via.name.split(" ")[0])}</span>
                  <span className="text-[12px] font-semibold uppercase tracking-[0.1em]">{t(locale, "opps.recommended")}</span>
                </Link>
              )}
              {introErr && <p role="alert" className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{t(locale, `opps.introErr.${introErr}`)}</p>}
              <form action={requestDirectIntroAction} className="mt-3 space-y-3">
                <input type="hidden" name="opportunityId" value={o.id} />
                <label className="block">
                  <span className="label">{t(locale, via ? "opps.orDirect" : "opps.directLabel").replace("{name}", first)}</span>
                  <textarea name="reason" required rows={3} maxLength={INTRO_REASON_MAX} className="input" placeholder={t(locale, "opps.reasonPh")} />
                </label>
                <p className="text-[12px] text-faint">{t(locale, "opps.directHint").replace("{name}", first)}</p>
                <SubmitButton className="btn-primary h-11 w-full"><Send size={15} /> {t(locale, "opps.requestIntro")}</SubmitButton>
              </form>
            </>
          )}
        </section>
      )}

      {!isMine && (
        <details id="report" className="mt-4 rounded-2xl px-1 text-[13px]" open={!!reportErr}>
          <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 rounded-full px-2 py-1 text-faint hover:text-fg">
            <Flag size={13} /> {myReport ? t(locale, "opps.reportedShort") : t(locale, "opps.report")}
          </summary>
          {!myReport && (
            <form action={reportOpportunityAction} className="glass mt-2 space-y-3 p-4">
              <input type="hidden" name="id" value={o.id} />
              {reportErr && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{t(locale, `opps.reportErr.${reportErr}`)}</p>}
              <fieldset>
                <legend className="label">{t(locale, "opps.reportWhy")}</legend>
                <div className="flex flex-wrap gap-1.5">
                  {REPORT_REASONS.map((r, i) => (
                    <label key={r} className="cursor-pointer rounded-full border border-line bg-white/80 px-3 py-1.5 text-[12.5px] font-medium text-muted has-[:checked]:border-accent has-[:checked]:bg-accent has-[:checked]:text-white">
                      <input type="radio" name="reason" value={r} defaultChecked={i === 0} className="sr-only" />
                      {t(locale, `report.${r}`)}
                    </label>
                  ))}
                </div>
              </fieldset>
              <textarea name="note" rows={2} maxLength={500} className="input text-[14px]" placeholder={t(locale, "opps.reportNotePh")} />
              <SubmitButton className="btn-secondary h-10 w-full text-[13px]">{t(locale, "opps.reportSend")}</SubmitButton>
            </form>
          )}
        </details>
      )}

      {admin && <AdminHide id={o.id} hidden={o.hidden} locale={locale} />}
    </TabPage>
  );
}

function StatusButton({ id, action, icon, label, primary = false }: { id: string; action: "fill" | "close" | "reopen"; icon: React.ReactNode; label: string; primary?: boolean }) {
  return (
    <form action={setOpportunityStatusAction}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="action" value={action} />
      <SubmitButton className={`${primary ? "btn-primary" : "btn-secondary"} h-10 w-full text-[13px]`}>{icon} {label}</SubmitButton>
    </form>
  );
}

function AdminHide({ id, hidden, locale }: { id: string; hidden: boolean; locale: Locale }) {
  return (
    <form action={adminSetOpportunityHiddenAction} className="mt-6 flex items-center justify-between gap-3 rounded-2xl border border-dashed border-line-strong px-4 py-3">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="hidden" value={hidden ? "0" : "1"} />
      <span className="text-[12.5px] text-faint">{t(locale, "admin.eyebrow")}</span>
      <SubmitButton className="btn-secondary h-9 text-[12.5px]">{hidden ? t(locale, "admin.unhide") : t(locale, "admin.hide")}</SubmitButton>
    </form>
  );
}
