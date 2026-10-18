import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, AtSign, Briefcase, Building2, Globe, Sparkles } from "lucide-react";
import { firstOpportunityAction, saveBasicsAction, saveFocusAction, saveOrgAction, saveProfileExtrasAction } from "@/app/onboarding-actions";
import { UserAvatar } from "@/components/avatar";
import { PhotoPicker } from "@/components/photo-picker";
import { SubmitButton } from "@/components/submit-button";
import { VerifiedOnMonad } from "@/components/wallet-badge";
import { getLocale, requireUser } from "@/lib/auth";
import { isGeneratedPlaceholder, isPlaceholderName } from "@/lib/handles";
import { APP_NAME } from "@/lib/brand";
import { ORG_TYPES, REGIONS } from "@/lib/constants";
import { prisma } from "@/lib/db";
import { ORG_TYPE_LABELS, REGION_LABELS, t, type Locale } from "@/lib/i18n";
import { parseList } from "@/lib/json";
import { avatarUrl } from "@/lib/media";
import { FOCUS_TAGS, MAX_FOCUS_TAGS, ONBOARDING_STEPS, isFocusTag, isOnboardingError, type OnboardingStep } from "@/lib/onboarding";
import { OPP_BODY_MAX, OPP_HEADLINE_MAX } from "@/lib/opportunities";

export const dynamic = "force-dynamic";
export const metadata = { title: "Welcome" };


export default async function WelcomePage({ searchParams }: { searchParams: Promise<{ step?: string; error?: string }> }) {
  const user = await requireUser();
  const locale = await getLocale();
  const sp = await searchParams;
  const current: OnboardingStep = (ONBOARDING_STEPS as readonly string[]).includes(sp.step ?? "") ? (sp.step as OnboardingStep) : "you";
  if (user.isDemo && !sp.step) redirect("/");
  const idx = ONBOARDING_STEPS.indexOf(current);
  const prev = idx > 0 ? ONBOARDING_STEPS[idx - 1] : null;
  const error = isOnboardingError(sp.error) ? t(locale, `onb.err.${sp.error}`) : null;

  return (
    <main className="relative min-h-dvh overflow-hidden px-5 pb-10 pt-5">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(80%_45%_at_50%_0%,rgb(196_181_253/0.55),transparent),radial-gradient(60%_40%_at_100%_100%,rgb(167_139_250/0.22),transparent)]" />
      <div className="relative mx-auto w-full max-w-[440px]">
        <header className="flex h-10 items-center justify-between">
          {prev ? (
            <Link href={`/welcome?step=${prev}`} className="btn-ghost h-9 w-9 p-0" aria-label={t(locale, "onb.back")}><ArrowLeft size={18} /></Link>
          ) : (
            <span className="flex items-center gap-2 text-[15px] font-bold tracking-tight">
              <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-accent"><span className="h-2.5 w-2.5 rounded-full bg-white" /></span>
              {APP_NAME}
            </span>
          )}
          <span className="text-[12px] font-semibold text-faint">{t(locale, "onb.stepOf").replace("{n}", String(idx + 1)).replace("{total}", String(ONBOARDING_STEPS.length))}</span>
        </header>
        <div className="mt-3 grid grid-cols-5 gap-1.5" aria-hidden>
          {ONBOARDING_STEPS.map((s, i) => (
            <span key={s} className={`h-1.5 rounded-full ${i <= idx ? "bg-accent" : "bg-lilac/50"}`} />
          ))}
        </div>

        <p className="mt-7 text-[12px] font-semibold uppercase tracking-[0.14em] text-accent-ink">{t(locale, `onb.${current}.eyebrow`)}</p>
        <h1 className="mt-1.5 text-[28px] font-semibold leading-[1.12] tracking-[-0.02em]">{t(locale, `onb.${current}.title`)}</h1>
        <p className="mt-2 text-[15px] leading-relaxed text-muted">{t(locale, `onb.${current}.body`)}</p>

        {error && <p role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

        <section className="glass mt-6 p-5">
          {current === "you" && <StepYou user={user} locale={locale} />}
          {current === "org" && <StepOrg user={user} locale={locale} />}
          {current === "focus" && <StepFocus user={user} locale={locale} />}
          {current === "profile" && <StepProfile user={user} locale={locale} />}
          {current === "first" && <StepFirst user={user} locale={locale} />}
        </section>
      </div>
    </main>
  );
}

type U = Awaited<ReturnType<typeof requireUser>>;
const field = "block";
const cta = "btn-primary h-12 w-full text-[15px] shadow-[0_10px_24px_-12px_rgb(124_58_237/0.7)]";

function StepYou({ user, locale }: { user: U; locale: Locale }) {
  return (
    <form action={saveBasicsAction} className="space-y-4">
      <div className="flex items-center gap-3">
        <UserAvatar name={user.name} seed={user.handle} src={avatarUrl(user.avatarKey)} size={48} />
        <div className="min-w-0">
          <p className="truncate text-[15px] font-semibold">@{user.handle}</p>
          {user.walletVerified ? <VerifiedOnMonad user={user} locale={locale} size="sm" /> : <p className="text-[12px] text-faint">{t(locale, "wallet.demoSession")}</p>}
        </div>
      </div>
      <label className={field}>
        <span className="label">{t(locale, "onb.name")}</span>
        <input name="name" defaultValue={isPlaceholderName(user.name) ? "" : user.name} required maxLength={80} autoComplete="name" className="input" />
      </label>
      <label className={field}>
        <span className="label">{t(locale, "handle.label")}</span>
        <span className="relative block">
          <AtSign size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-faint" />
          <input
            name="handle"
            defaultValue={isGeneratedPlaceholder(user) ? "" : user.handle}
            maxLength={25}
            pattern="@?[A-Za-z0-9_]{2,24}"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            className="input pl-10"
            placeholder={t(locale, "handle.placeholder")}
            data-testid="onb-handle"
          />
        </span>
        <span className="mt-1.5 block text-[12px] text-faint">{t(locale, isGeneratedPlaceholder(user) ? "handle.hintAuto" : "handle.hint")}</span>
      </label>
      <label className={field}>
        <span className="label">{t(locale, "onb.headline")}</span>
        <input name="headline" defaultValue={user.headline} required maxLength={100} className="input" placeholder={t(locale, "onb.headlinePh")} />
      </label>
      <SubmitButton className={cta}>{t(locale, "onb.continue")}</SubmitButton>
    </form>
  );
}

async function StepOrg({ user, locale }: { user: U; locale: Locale }) {
  const orgs = await prisma.organization.findMany({ select: { name: true, slug: true }, orderBy: { name: "asc" } });
  const pending = await prisma.orgRequest.findFirst({ where: { userId: user.id, status: "pending" }, select: { name: true } });
  return (
    <form action={saveOrgAction} className="space-y-4">
      <label className={field}>
        <span className="label">{t(locale, "onb.org")}</span>
        <span className="relative block">
          <Building2 size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-faint" />
          <input name="org" list="org-list" defaultValue={user.orgName} maxLength={80} className="input pl-10" placeholder={t(locale, "onb.orgPh")} autoComplete="organization" />
        </span>
        <datalist id="org-list">{orgs.map((o) => <option key={o.slug} value={o.name} />)}</datalist>
        <span className="mt-1.5 block text-[12px] text-faint">{t(locale, "onb.orgHint").replace("{n}", String(orgs.length))}</span>
      </label>
      {user.walletVerified ? (
        <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-lilac/80 bg-accent-soft/40 p-3.5">
          <input type="checkbox" name="claim" defaultChecked className="mt-0.5 h-4 w-4 accent-[#7c3aed]" />
          <span>
            <span className="block text-[14px] font-semibold">{t(locale, "onb.claim")}</span>
            <span className="mt-0.5 block text-[12.5px] leading-snug text-muted">{t(locale, "onb.claimHint")}</span>
          </span>
        </label>
      ) : null}
      <details className="rounded-2xl border border-dashed border-line-strong bg-white/50 p-3.5" open={!!pending}>
        <summary className="cursor-pointer text-[13.5px] font-semibold text-accent">{t(locale, "onb.orgMissing")}</summary>
        <p className="mt-2 text-[12.5px] text-muted">{pending ? t(locale, "onb.orgRequested").replace("{name}", pending.name) : t(locale, "onb.orgMissingHint")}</p>
        <div className="mt-3 grid grid-cols-2 gap-2.5">
          <label className={field}>
            <span className="label">{t(locale, "org.website")}</span>
            <input name="website" maxLength={300} className="input" placeholder="acme.com" />
          </label>
          <label className={field}>
            <span className="label">{t(locale, "org.type")}</span>
            <select name="type" defaultValue="fintech" className="input">
              {ORG_TYPES.map((x) => <option key={x} value={x}>{ORG_TYPE_LABELS[locale][x]}</option>)}
            </select>
          </label>
        </div>
      </details>
      <SubmitButton className={cta}>{t(locale, "onb.continue")}</SubmitButton>
    </form>
  );
}

function StepFocus({ user, locale }: { user: U; locale: Locale }) {
  const mine = new Set(parseList(user.focusTags));
  const chip =
    "cursor-pointer select-none rounded-full border border-line bg-white/80 px-3.5 py-2 text-[13.5px] font-medium text-muted transition has-[:checked]:border-accent has-[:checked]:bg-accent has-[:checked]:text-white has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent/40";
  return (
    <form action={saveFocusAction} className="space-y-5">
      <fieldset>
        <legend className="label">{t(locale, "onb.region")}</legend>
        <div className="flex flex-wrap gap-2">
          {REGIONS.map((r) => (
            <label key={r} className={chip}>
              <input type="radio" name="region" value={r} defaultChecked={user.region === r} required className="sr-only" />
              {REGION_LABELS[locale][r]}
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend className="label">{t(locale, "onb.focus").replace("{max}", String(MAX_FOCUS_TAGS))}</legend>
        <div className="flex flex-wrap gap-2">
          {FOCUS_TAGS.map((tag) => (
            <label key={tag} className={chip}>
              <input type="checkbox" name="tags" value={tag} defaultChecked={mine.has(tag)} className="sr-only" />
              {t(locale, `focus.${tag}`)}
            </label>
          ))}
        </div>
      </fieldset>
      <SubmitButton className={cta}>{t(locale, "onb.continue")}</SubmitButton>
    </form>
  );
}

function StepProfile({ user, locale }: { user: U; locale: Locale }) {
  const linkRow = "relative block";
  const ico = "pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-faint";
  return (
    <form action={saveProfileExtrasAction} className="space-y-5">
      <PhotoPicker
        current={avatarUrl(user.avatarKey)}
        fallback={<UserAvatar name={user.name} seed={user.handle} size={84} ring />}
        label={t(locale, "onb.photo")}
        hint={t(locale, "onb.photoHint")}
      />
      <div className="space-y-2.5">
        <span className="label">{t(locale, "onb.links")}</span>
        <label className={linkRow}><AtSign size={16} className={ico} /><input name="x" defaultValue={user.linkX.replace("https://x.com/", "")} maxLength={300} className="input pl-10" placeholder={t(locale, "onb.xPh")} aria-label="X" /></label>
        <label className={linkRow}><Briefcase size={16} className={ico} /><input name="linkedin" defaultValue={user.linkLinkedin} maxLength={300} className="input pl-10" placeholder="linkedin.com/in/…" aria-label="LinkedIn" /></label>
        <label className={linkRow}><Globe size={16} className={ico} /><input name="website" defaultValue={user.linkWebsite} maxLength={300} className="input pl-10" placeholder={t(locale, "onb.websitePh")} aria-label={t(locale, "org.website")} /></label>
      </div>
      <SubmitButton className={cta}>{t(locale, "onb.continue")}</SubmitButton>
    </form>
  );
}

function StepFirst({ user, locale }: { user: U; locale: Locale }) {
  const topics = parseList(user.focusTags).filter(isFocusTag);
  return (
    <form action={firstOpportunityAction} className="space-y-4">
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
      <label className={field}>
        <span className="label">{t(locale, "opps.headline")}</span>
        <input name="headline" maxLength={OPP_HEADLINE_MAX} className="input" placeholder={t(locale, "onb.firstPh")} />
      </label>
      <label className={field}>
        <span className="label">{t(locale, "opps.body")}</span>
        <textarea name="body" rows={3} maxLength={OPP_BODY_MAX} className="input" placeholder={t(locale, "opps.bodyPh")} />
      </label>
      {topics.length > 0 && (
        <fieldset>
          <legend className="label">{t(locale, "opps.topic")}</legend>
          <div className="flex flex-wrap gap-2">
            {topics.map((tag, i) => (
              <label key={tag} className="cursor-pointer select-none rounded-full border border-line bg-white/80 px-3 py-1.5 text-[12.5px] font-medium text-muted transition has-[:checked]:border-accent has-[:checked]:bg-accent has-[:checked]:text-white">
                <input type="radio" name="topic" value={tag} defaultChecked={i === 0} className="sr-only" />
                {t(locale, `focus.${tag}`)}
              </label>
            ))}
          </div>
          <p className="mt-2 flex items-center gap-1.5 text-[12.5px] text-accent-ink">
            <Sparkles size={13} /> {t(locale, "onb.firstHint").replace("{topic}", t(locale, `focus.${topics[0]}`))}
          </p>
        </fieldset>
      )}
      <SubmitButton className={cta}>{t(locale, "onb.post")}</SubmitButton>
      <button name="skip" value="1" formNoValidate className="btn-ghost h-11 w-full text-[14px]">{t(locale, "onb.skip")}</button>
    </form>
  );
}
