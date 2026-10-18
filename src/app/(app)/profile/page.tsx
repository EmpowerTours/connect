import { AtSign, Briefcase, Globe, Trash2 } from "lucide-react";
import { updateProfileAction } from "@/app/actions";
import { removePhotoAction, saveFocusAction, saveProfileExtrasAction } from "@/app/onboarding-actions";
import { UserAvatar } from "@/components/avatar";
import { ProofBadges } from "@/components/badges";
import { MeraLinkWallet } from "@/components/mera-sign-in";
import { PhotoPicker } from "@/components/photo-picker";
import { VerifiedOnMonad } from "@/components/wallet-badge";
import { Columns, PageHeader } from "@/components/layout";
import { SubmitButton } from "@/components/submit-button";
import { getLocale, requireUser } from "@/lib/auth";
import { isGeneratedPlaceholder, isPlaceholderHandle, isPlaceholderName } from "@/lib/handles";
import { prisma } from "@/lib/db";
import { REGIONS } from "@/lib/constants";
import { REGION_LABELS, t } from "@/lib/i18n";
import { parseList } from "@/lib/json";
import { avatarUrl } from "@/lib/media";
import { FOCUS_TAGS, MAX_FOCUS_TAGS, isOnboardingError } from "@/lib/onboarding";

export const dynamic = "force-dynamic";

export default async function EditProfilePage({ searchParams }: { searchParams: Promise<{ error?: string; saved?: string }> }) {
  const user = await requireUser();
  const locale = await getLocale();
  const { error, saved } = await searchParams;
  const extrasError = isOnboardingError(error) ? t(locale, `onb.err.${error}`) : null;
  const mine = new Set(parseList(user.focusTags));
  const chip =
    "cursor-pointer select-none rounded-full border border-line bg-white/80 px-3.5 py-2 text-[13.5px] font-medium text-muted transition has-[:checked]:border-accent has-[:checked]:bg-accent has-[:checked]:text-white has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent/40";
  const ico = "pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-faint";
  const orgs = await prisma.organization.findMany({ select: { name: true }, orderBy: { name: "asc" } });
  const field = "block";
  const placeholder = isPlaceholderHandle(user.handle);
  return (
    <Columns>
      <PageHeader title={t(locale, "profile.edit")} back={`/u/${user.handle}`} />
      <div className="space-y-5 p-4">
        {saved && <p role="status" className="rounded-xl bg-accent-soft p-3 text-sm font-medium text-accent-ink">{t(locale, "profile.saved")}</p>}
        {extrasError && <p role="alert" className="rounded-xl bg-danger/10 p-3 text-sm text-danger">{extrasError}</p>}
        {error === "handle" && <p className="rounded-xl bg-danger/10 p-3 text-sm text-danger">{t(locale, "profile.handleTaken")}</p>}
        {placeholder && (
          <p role="status" className="rounded-xl border border-lilac/80 bg-accent-soft/60 p-3 text-sm text-accent-ink" data-testid="handle-placeholder">
            {t(locale, "handle.pickPrompt")}
          </p>
        )}
        <form action={updateProfileAction} className="grid gap-4 sm:grid-cols-2">
          <label className={field}><span className="label">{t(locale, "profile.name")}</span><input name="name" defaultValue={isPlaceholderName(user.name) ? "" : user.name} required maxLength={80} className="input" /></label>
          <label className={field}>
            <span className="label">{t(locale, "profile.handle")}</span>
            <span className="relative block">
              <AtSign size={16} className={ico} />
              <input
                name="handle"
                defaultValue={isGeneratedPlaceholder(user) ? "" : user.handle}
                required
                maxLength={25}
                pattern="@?[A-Za-z0-9_]{2,24}"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                placeholder={t(locale, "handle.placeholder")}
                className="input pl-10"
                data-testid="profile-handle"
              />
            </span>
            <span className="mt-1.5 block text-[12px] text-faint">{t(locale, "handle.hint")}</span>
          </label>
          <label className={field}><span className="label">{t(locale, "profile.role")}</span><input name="role" defaultValue={user.headline || user.role} className="input" /></label>
          <label className={field}><span className="label">{t(locale, "profile.org")}</span><input name="orgName" defaultValue={user.orgName} list="orgs" className="input" /></label>
          <datalist id="orgs">{orgs.map((o) => <option key={o.name} value={o.name} />)}</datalist>
          <label className={field}><span className="label">{t(locale, "profile.location")}</span><input name="location" defaultValue={user.location} className="input" /></label>
          <label className={field}><span className="label">{t(locale, "profile.locale")}</span>
            <select name="locale" defaultValue={user.locale} className="input">
              <option value="en">English</option>
              <option value="es">Español</option>
            </select>
          </label>
          <label className={`${field} sm:col-span-2`}><span className="label">{t(locale, "profile.bio")}</span><textarea name="bio" defaultValue={user.bio} rows={3} className="input" /></label>
          <label className={`${field} sm:col-span-2`}><span className="label">{t(locale, "profile.voice")}</span><textarea name="voice" defaultValue={user.voice} rows={2} placeholder="Short, direct, no buzzwords…" className="input" /></label>
          <div className="sm:col-span-2"><SubmitButton className="btn-primary">{t(locale, "profile.save")}</SubmitButton></div>
        </form>
        <section id="photo" className="glass scroll-mt-20 p-4">
          <h2 className="mb-3 font-bold">{t(locale, "profile.photoLinks")}</h2>
          <form action={saveProfileExtrasAction} className="space-y-4">
            <input type="hidden" name="back" value="profile" />
            <PhotoPicker
              current={avatarUrl(user.avatarKey)}
              fallback={<UserAvatar name={user.name} seed={user.handle} size={72} ring />}
              label={t(locale, "onb.photo")}
              hint={t(locale, "onb.photoHint")}
            />
            <div className="space-y-2.5">
              <label className="relative block"><AtSign size={16} className={ico} /><input name="x" defaultValue={user.linkX.replace("https://x.com/", "")} maxLength={300} className="input pl-10" placeholder={t(locale, "onb.xPh")} aria-label="X" /></label>
              <label className="relative block"><Briefcase size={16} className={ico} /><input name="linkedin" defaultValue={user.linkLinkedin} maxLength={300} className="input pl-10" placeholder="linkedin.com/in/…" aria-label="LinkedIn" /></label>
              <label className="relative block"><Globe size={16} className={ico} /><input name="website" defaultValue={user.linkWebsite} maxLength={300} className="input pl-10" placeholder={t(locale, "onb.websitePh")} aria-label={t(locale, "org.website")} /></label>
            </div>
            <SubmitButton className="btn-primary">{t(locale, "profile.save")}</SubmitButton>
          </form>
          {user.avatarKey && (
            <form action={removePhotoAction} className="mt-2">
              <button className="btn-ghost h-8 text-xs text-faint"><Trash2 size={14} />{t(locale, "profile.removePhoto")}</button>
            </form>
          )}
        </section>
        <section id="focus" className="card scroll-mt-20 p-4">
          <h2 className="mb-3 font-bold">{t(locale, "profile.focus")}</h2>
          <form action={saveFocusAction} className="space-y-4">
            <input type="hidden" name="back" value="profile" />
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
            <SubmitButton className="btn-secondary">{t(locale, "profile.save")}</SubmitButton>
          </form>
        </section>
        <section id="wallet" className="glass p-4">
          <h2 className="mb-1 font-bold">{t(locale, "wallet.mera")}</h2>
          {user.walletVerified && user.walletAddress ? (
            <>
              <p className="mb-3 text-sm text-faint">{t(locale, "wallet.verifiedHint")}</p>
              <VerifiedOnMonad user={user} locale={locale} />
              <p className="mt-2 break-all font-mono text-xs text-faint">{user.walletAddress}</p>
            </>
          ) : (
            <>
              <p className="mb-3 text-sm text-faint">{t(locale, "wallet.linkHint")}</p>
              <MeraLinkWallet locale={locale} displayName={user.name} />
            </>
          )}
        </section>
        <section className="card p-4">
          <h2 className="mb-1 font-bold">{t(locale, "proof.title")}</h2>
          <p className="mb-3 text-sm text-faint">{t(locale, "profile.verifyHint")}</p>
          <ProofBadges user={user} locale={locale} />
          <div className="mt-3 flex flex-wrap gap-2">
            {[t(locale, "proof.workEmail"), "LinkedIn"].map((m) => (
              <button key={m} disabled className="btn-secondary h-8 text-xs" title={t(locale, "proof.soon")}>{t(locale, "proof.verifyWith")} {m}</button>
            ))}
          </div>
        </section>
      </div>
    </Columns>
  );
}
