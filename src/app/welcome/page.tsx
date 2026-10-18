import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, Building2, Check, Hash, Landmark, Users } from "lucide-react";
import { finishOnboardingAction, onboardingFarcasterAction, saveBasicsAction, saveFocusAction } from "@/app/onboarding-actions";
import { UserAvatar } from "@/components/avatar";
import { FarcasterMark } from "@/components/farcaster-mark";
import { SubmitButton } from "@/components/submit-button";
import { VerifiedOnMonad } from "@/components/wallet-badge";
import { getLocale, requireUser } from "@/lib/auth";
import { APP_NAME } from "@/lib/brand";
import { ORG_TYPES, REGIONS } from "@/lib/constants";
import { prisma } from "@/lib/db";
import { rankPacks } from "@/lib/curated-packs";
import { loadPackPreviews } from "@/lib/curated-packs-db";
import { ORG_TYPE_LABELS, REGION_LABELS, t, type Locale, type MessageKey } from "@/lib/i18n";
import { parseList } from "@/lib/json";
import { avatarUrl } from "@/lib/media";
import { FOCUS_TAGS, MAX_FOCUS_TAGS, ONBOARDING_STEPS, isOnboardingError, type OnboardingStep } from "@/lib/onboarding";

export const dynamic = "force-dynamic";
export const metadata = { title: "Welcome" };


type Search = { step?: string; error?: string; fc?: string; fcError?: string; partial?: string };

export default async function WelcomePage({ searchParams }: { searchParams: Promise<Search> }) {
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
        <div className="mt-3 grid grid-cols-3 gap-1.5" aria-hidden>
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
          {current === "focus" && <StepFocus user={user} locale={locale} />}
          {current === "follow" && <StepFollowSource user={user} locale={locale} sp={sp} />}
        </section>
        {current === "follow" && <StepFollow user={user} locale={locale} />}
      </div>
    </main>
  );
}

type U = Awaited<ReturnType<typeof requireUser>>;
const field = "block";
const cta = "btn-primary h-12 w-full text-[15px] shadow-[0_10px_24px_-12px_rgb(124_58_237/0.7)]";

async function StepYou({ user, locale }: { user: U; locale: Locale }) {
  const orgs = await prisma.organization.findMany({ select: { name: true, slug: true }, orderBy: { name: "asc" } });
  const pending = await prisma.orgRequest.findFirst({ where: { userId: user.id, status: "pending" }, select: { name: true } });
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
        <input name="name" defaultValue={user.name} required maxLength={80} autoComplete="name" className="input" />
      </label>
      <label className={field}>
        <span className="label">{t(locale, "onb.headline")}</span>
        <input name="headline" defaultValue={user.headline} required maxLength={100} className="input" placeholder={t(locale, "onb.headlinePh")} />
      </label>
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
      <fieldset className="min-w-0">
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
      <fieldset className="min-w-0">
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

/** Step 3, top card: find people you already follow on Farcaster (optional). */
async function StepFollowSource({ user, locale, sp }: { user: U; locale: Locale; sp: Search }) {
  const hasWallet = user.walletVerified && !!user.walletAddress;
  const fcKey = `import.error.${sp.fcError}` as MessageKey;
  const fcError = sp.fcError ? t(locale, sp.fcError in IMPORT_ERRORS ? fcKey : "import.error.unavailable") : null;
  const matched = sp.fc !== undefined ? Math.max(0, Number.parseInt(sp.fc, 10) || 0) : null;
  return (
    <div id="farcaster" className="scroll-mt-6" data-testid="onb-farcaster">
      <div className="flex items-start gap-3">
        <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-accent-soft text-accent-ink"><FarcasterMark /></span>
        <div className="min-w-0 flex-1">
          <h2 className="text-[16px] font-semibold tracking-tight">{t(locale, "onb.fc.title")}</h2>
          <p className="mt-0.5 text-[13px] leading-snug text-muted">{t(locale, "onb.fc.body")}</p>
        </div>
      </div>
      <form action={onboardingFarcasterAction} className="mt-3 flex gap-2">
        <input name="username" defaultValue={user.farcasterUsername} className="input h-10 flex-1 py-1.5" placeholder={t(locale, "import.fc.placeholder")} aria-label={t(locale, "import.fc.placeholder")} autoComplete="off" />
        <SubmitButton className="btn-primary h-10 shrink-0 text-[13px]">{t(locale, "onb.fc.cta")}</SubmitButton>
      </form>
      <p className="mt-2 text-[12px] text-faint">{t(locale, hasWallet ? "import.fc.walletHint" : "import.fc.noWalletHint")}</p>
      {fcError && <p role="alert" className="mt-3 rounded-xl bg-danger/10 px-3 py-2 text-[13px] text-danger">{fcError}</p>}
      {matched !== null && !fcError && (
        <p role="status" className="mt-3 rounded-xl bg-accent-soft px-3 py-2 text-[13px] text-accent-ink">
          {matched > 0 ? t(locale, "onb.fc.found").replace("{n}", String(matched)) : t(locale, "onb.fc.none")}
          {sp.partial ? ` ${t(locale, "import.partial")}` : ""}
        </p>
      )}
    </div>
  );
}

/** Farcaster-import error codes with a message (src/lib/i18n.ts import.error.*). */
const IMPORT_ERRORS: Record<string, true> = { username: true, need_wallet: true, not_found: true, not_found_wallet: true, unavailable: true, rate_limited: true };

/** Step 3, main card: starter packs (preselected from the focus areas) and Farcaster matches, then finish. */
async function StepFollow({ user, locale }: { user: U; locale: Locale }) {
  const ranked = rankPacks(parseList(user.focusTags));
  const [previews, matches] = await Promise.all([
    loadPackPreviews(user.id, ranked.map((r) => r.pack)),
    prisma.importSuggestion.findMany({
      where: { userId: user.id, status: "pending", targetUserId: { not: null } },
      include: { targetUser: { select: { id: true, name: true, handle: true, headline: true, orgName: true, avatarKey: true } } },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
  ]);
  const byId = new Map(previews.map((p) => [p.pack.id, p]));
  return (
    <form action={finishOnboardingAction} className="glass mt-4 space-y-4 p-5" data-testid="onb-packs">
      {matches.length > 0 && (
        <fieldset className="min-w-0">
          <legend className="label">{t(locale, "onb.fc.matches").replace("{n}", String(matches.length))}</legend>
          <ul className="divide-y divide-line/70 overflow-hidden rounded-2xl border border-line bg-white/70">
            {matches.map((m) => m.targetUser && (
              <li key={m.id}>
                <label className="flex cursor-pointer items-center gap-3 px-3 py-2.5">
                  <input type="checkbox" name="ids" value={m.id} defaultChecked className="h-4 w-4 accent-[#7c3aed]" />
                  <UserAvatar name={m.targetUser.name} seed={m.targetUser.handle} src={avatarUrl(m.targetUser.avatarKey)} size={32} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-semibold">{m.targetUser.name}</span>
                    <span className="block truncate text-[12px] text-faint">{[m.targetUser.headline, m.targetUser.orgName].filter(Boolean).join(" @ ") || `@${m.targetUser.handle}`}</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </fieldset>
      )}
      <fieldset className="min-w-0">
        <legend className="label">{t(locale, "onb.packs")}</legend>
        <p className="-mt-1 mb-3 text-[12.5px] leading-snug text-muted">{t(locale, "onb.packsHint")}</p>
        <div className="space-y-2.5">
          {ranked.map(({ pack, preselected }) => {
            const p = byId.get(pack.id);
            if (!p) return null;
            return (
              <label key={pack.id} className="flex cursor-pointer items-start gap-3 rounded-2xl border border-line bg-white/80 p-3.5 transition has-[:checked]:border-accent has-[:checked]:bg-accent-soft/50" data-testid={`pack-${pack.id}`}>
                <input type="checkbox" name="packs" value={pack.id} defaultChecked={preselected} className="peer sr-only" />
                <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md border border-line-strong bg-white text-transparent peer-checked:border-accent peer-checked:bg-accent peer-checked:text-white">
                  <Check size={13} strokeWidth={3} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[14.5px] font-semibold">{pack.label[locale]}</span>
                  <span className="mt-0.5 block text-[12.5px] leading-snug text-muted">{pack.blurb[locale]}</span>
                  <span className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-faint">
                    {p.channels.length > 0 && <span className="inline-flex items-center gap-1"><Hash size={12} />{p.channels.map((c) => c.slug).join(", ")}</span>}
                    {p.orgs.length > 0 && <span className="inline-flex items-center gap-1"><Landmark size={12} />{t(locale, "onb.packOrgs").replace("{n}", String(p.orgs.length))}</span>}
                    {p.people.length > 0 && (
                      <span className="inline-flex items-center gap-1.5">
                        <Users size={12} />
                        <span className="flex -space-x-1.5">
                          {p.people.slice(0, 4).map((u) => <UserAvatar key={u.id} name={u.name} seed={u.handle} src={avatarUrl(u.avatarKey)} size={18} ring />)}
                        </span>
                        {t(locale, "onb.packPeople").replace("{n}", String(p.people.length))}
                      </span>
                    )}
                  </span>
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>
      <SubmitButton className={cta}>{t(locale, "onb.finish")}</SubmitButton>
      <button name="skip" value="1" formNoValidate className="btn-ghost h-11 w-full text-[14px]">{t(locale, "onb.skip")}</button>
    </form>
  );
}
