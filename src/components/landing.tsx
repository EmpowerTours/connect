import Link from "next/link";
import { AppWindow, ArrowRight, Building2, ChevronRight, Code2, Fingerprint, Hash, ShieldCheck, SlidersHorizontal } from "lucide-react";
import { UserAvatar } from "@/components/avatar";
import { SOURCE_URL } from "@/lib/brand";
import { listFeedAlgorithms } from "@/lib/feed-algorithms";
import { t, type Locale } from "@/lib/i18n";
import { loginPath } from "@/lib/links";
import { avatarUrl } from "@/lib/media";

export type LandingInviter = { name: string; handle: string; avatarKey: string | null; headline: string; orgName: string };

/**
 * Home page for signed-out visitors (src/app/(open)/page.tsx): what Connect is, in three ideas,
 * and the way in. Inside PublicFrame, which hides its floating sign-up bar on "/".
 */
export function Landing({ locale, inviter, stats }: { locale: Locale; inviter: LandingInviter | null; stats: { orgs: number; channels: number } }) {
  const join = loginPath("/", { join: true });
  const feeds = listFeedAlgorithms().map((a) => a.label[locale]);
  return (
    <main className="relative overflow-hidden" data-testid="landing">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[560px] bg-[radial-gradient(70%_60%_at_50%_0%,rgb(196_181_253/0.55),transparent),radial-gradient(50%_50%_at_100%_30%,rgb(167_139_250/0.22),transparent)]" />
      <section className="relative mx-auto max-w-[1080px] px-5 pb-10 pt-10 md:px-8 md:pt-16">
        {inviter && (
          <div className="mb-6 flex max-w-[520px] items-center gap-3 rounded-2xl border border-lilac bg-white/80 p-3 shadow-[0_10px_30px_-18px_rgb(91_33_182/0.45)]" data-testid="landing-inviter">
            <UserAvatar name={inviter.name} seed={inviter.handle} src={avatarUrl(inviter.avatarKey)} size={40} />
            <div className="min-w-0">
              <p className="truncate text-[14.5px] font-semibold">{t(locale, "landing.invitedBy").replace("{name}", inviter.name)}</p>
              <p className="truncate text-[12.5px] text-muted">{[inviter.headline, inviter.orgName].filter(Boolean).join(" @ ") || t(locale, "landing.invitedBody")}</p>
            </div>
          </div>
        )}
        <span className="inline-flex items-center gap-1.5 rounded-full border border-lilac bg-white/70 px-2.5 py-1 text-xs font-semibold text-accent-ink">
          <span className="h-1.5 w-1.5 rounded-full bg-accent" />
          {t(locale, "landing.eyebrow")}
        </span>
        <h1 className="mt-4 max-w-[760px] text-[38px] font-bold leading-[1.05] tracking-[-0.03em] md:text-[58px]">{t(locale, "landing.title")}</h1>
        <p className="mt-4 max-w-[620px] text-[16px] leading-relaxed text-muted md:text-[18px]">{t(locale, "landing.body")}</p>
        <div className="mt-7 flex flex-col gap-2.5 sm:flex-row sm:items-center">
          <Link href={join} className="btn-primary h-12 px-6 text-[15px] shadow-[0_12px_28px_-12px_rgb(124_58_237/0.75)]" data-testid="landing-cta">
            <Fingerprint size={18} /> {t(locale, "landing.cta")}
          </Link>
          <Link href={loginPath("/")} className="btn-secondary h-12 px-6 text-[15px]">
            {t(locale, "landing.signIn")}
          </Link>
        </div>
        <p className="mt-3 text-[12.5px] text-faint">{t(locale, "landing.ctaNote")}</p>
      </section>

      <section className="relative mx-auto grid max-w-[1080px] gap-4 px-5 md:grid-cols-3 md:px-8">
        <Feature icon={SlidersHorizontal} title={t(locale, "landing.feeds.title")} body={t(locale, "landing.feeds.body")} testId="landing-feeds">
          <div className="flex flex-wrap gap-1.5">
            {feeds.map((label) => (
              <span key={label} className="chip border-lilac bg-white/80 text-[12px] text-accent-ink">{label}</span>
            ))}
          </div>
        </Feature>
        <Feature icon={ShieldCheck} title={t(locale, "landing.graph.title")} body={t(locale, "landing.graph.body")} testId="landing-graph">
          <Link href="/graph" className="inline-flex items-center gap-1 text-[13px] font-semibold text-accent hover:underline">
            {t(locale, "landing.graph.cta")} <ChevronRight size={14} />
          </Link>
        </Feature>
        <Feature icon={AppWindow} title={t(locale, "landing.fc.title")} body={t(locale, "landing.fc.body")} testId="landing-farcaster">
          <span className="chip border-dashed border-line-strong bg-white/70 text-[12px] text-muted">{t(locale, "landing.fc.soon")}</span>
        </Feature>
      </section>

      <section className="relative mx-auto mt-8 flex max-w-[1080px] flex-wrap items-center gap-x-6 gap-y-2 px-5 text-[13.5px] text-muted md:px-8">
        <span className="inline-flex items-center gap-1.5"><Building2 size={15} className="text-accent" /> <b className="font-semibold text-fg">{stats.orgs}</b> {t(locale, "landing.stats.orgs")}</span>
        <span className="inline-flex items-center gap-1.5"><Hash size={15} className="text-accent" /> <b className="font-semibold text-fg">{stats.channels}</b> {t(locale, "landing.stats.channels")}</span>
        <a href={SOURCE_URL} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 hover:text-fg"><Code2 size={15} className="text-accent" /> {t(locale, "landing.stats.open")}</a>
      </section>

      <section className="relative mx-auto mt-10 max-w-[1080px] px-5 pb-16 md:px-8">
        <div className="flex flex-col gap-4 rounded-[28px] border border-white/80 p-6 shadow-[0_18px_40px_-18px_rgb(91_33_182/0.35)] md:flex-row md:items-center md:p-8" style={{ background: "linear-gradient(140deg, #faf8ff 0%, #efe9ff 42%, #ddd0ff 100%)" }}>
          <div className="min-w-0 flex-1">
            <h2 className="text-[24px] font-bold tracking-tight">{t(locale, "landing.final.title")}</h2>
            <p className="mt-1 text-[14.5px] text-muted">{t(locale, "landing.final.body")}</p>
          </div>
          <Link href={join} className="btn-primary h-12 shrink-0 px-6 text-[15px]">
            {t(locale, "landing.cta")} <ArrowRight size={17} />
          </Link>
        </div>
      </section>
    </main>
  );
}

function Feature({ icon: Icon, title, body, testId, children }: { icon: typeof Hash; title: string; body: string; testId: string; children: React.ReactNode }) {
  return (
    <article className="glass flex flex-col gap-3 p-5" data-testid={testId}>
      <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-lavender to-accent text-white"><Icon size={21} /></span>
      <h2 className="text-[18px] font-semibold leading-snug tracking-tight">{title}</h2>
      <p className="flex-1 text-[14px] leading-relaxed text-muted">{body}</p>
      <div>{children}</div>
    </article>
  );
}
