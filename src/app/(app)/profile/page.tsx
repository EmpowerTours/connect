import { updateProfileAction } from "@/app/actions";
import { UserAvatar } from "@/components/avatar";
import { ProofBadges } from "@/components/badges";
import { MeraLinkWallet } from "@/components/mera-sign-in";
import { VerifiedOnMonad } from "@/components/wallet-badge";
import { Columns, PageHeader } from "@/components/layout";
import { SubmitButton } from "@/components/submit-button";
import { getLocale, requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { t } from "@/lib/i18n";

export const dynamic = "force-dynamic";

export default async function EditProfilePage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const user = await requireUser();
  const locale = await getLocale();
  const { error } = await searchParams;
  const orgs = await prisma.organization.findMany({ select: { name: true }, orderBy: { name: "asc" } });
  const field = "block";
  return (
    <Columns>
      <PageHeader title={t(locale, "profile.edit")} back={`/u/${user.handle}`} />
      <div className="space-y-5 p-4">
        <div className="flex items-center gap-4">
          <UserAvatar name={user.name} seed={user.handle} size={64} />
          <p className="text-sm text-faint">{t(locale, "profile.avatarNote")}</p>
        </div>
        {error === "handle" && <p className="rounded-xl bg-danger/10 p-3 text-sm text-danger">{t(locale, "profile.handleTaken")}</p>}
        <form action={updateProfileAction} className="grid gap-4 sm:grid-cols-2">
          <label className={field}><span className="label">{t(locale, "profile.name")}</span><input name="name" defaultValue={user.name} required className="input" /></label>
          <label className={field}><span className="label">{t(locale, "profile.handle")}</span><input name="handle" defaultValue={user.handle} required pattern="[a-z0-9_]{2,24}" className="input" /></label>
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
