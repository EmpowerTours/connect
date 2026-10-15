import Link from "next/link";
import { updateProfileAction } from "@/app/actions";
import { SubmitButton } from "@/components/submit-button";
import { Avatar, VerifiedBadge } from "@/components/ui";
import { getLocale, requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { t } from "@/lib/i18n";

export const dynamic = "force-dynamic";

export default async function ProfilePage({ searchParams }: { searchParams: Promise<{ saved?: string; error?: string }> }) {
  const user = await requireUser();
  const locale = await getLocale();
  const { saved, error } = await searchParams;
  const orgs = await prisma.organization.findMany({ select: { name: true }, orderBy: { name: "asc" } });
  const field = "text-xs text-zinc-400";
  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <div className="flex items-center gap-4">
        <Avatar name={user.name} size={56} />
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">{user.name} <VerifiedBadge verified={user.verified} locale={locale} /></h1>
          <Link href={`/u/${user.handle}`} className="text-sm text-violet-300">@{user.handle}</Link>
        </div>
      </div>
      <div className="card border-dashed p-4 text-sm text-zinc-400">
        <p className="mb-2 font-medium text-zinc-200">{t(locale, "profile.verified")}?</p>
        <p className="mb-3">{t(locale, "profile.verifyHint")}</p>
        <div className="flex flex-wrap gap-2">
          {["Wallet (SIWE)", "Farcaster", "LinkedIn"].map((m) => (
            <button key={m} disabled className="btn-ghost cursor-not-allowed opacity-50">{m}</button>
          ))}
        </div>
      </div>
      {saved && <p className="rounded-lg bg-emerald-500/10 p-2 text-sm text-emerald-300">✓ {t(locale, "common.saved")}</p>}
      {error === "handle" && <p className="rounded-lg bg-rose-500/10 p-2 text-sm text-rose-300">Handle taken.</p>}
      <form action={updateProfileAction} className="card grid gap-3 p-4 sm:grid-cols-2">
        <label className={field}>{t(locale, "profile.name")}<input name="name" defaultValue={user.name} required className="input mt-1" /></label>
        <label className={field}>{t(locale, "profile.handle")}<input name="handle" defaultValue={user.handle} required pattern="[a-z0-9_]{2,24}" className="input mt-1" /></label>
        <label className={field}>{t(locale, "profile.role")}<input name="role" defaultValue={user.role} className="input mt-1" /></label>
        <label className={field}>{t(locale, "profile.org")}<input name="orgName" defaultValue={user.orgName} list="orgs" className="input mt-1" /></label>
        <datalist id="orgs">{orgs.map((o) => <option key={o.name} value={o.name} />)}</datalist>
        <label className={`${field} sm:col-span-2`}>{t(locale, "profile.bio")}<textarea name="bio" defaultValue={user.bio} rows={3} className="input mt-1" /></label>
        <label className={`${field} sm:col-span-2`}>{t(locale, "profile.voice")}<textarea name="voice" defaultValue={user.voice} rows={2} placeholder="Short, direct, no buzzwords…" className="input mt-1" /></label>
        <label className={field}>{t(locale, "profile.locale")}
          <select name="locale" defaultValue={user.locale} className="input mt-1">
            <option value="en">English</option>
            <option value="es">Español</option>
          </select>
        </label>
        <div className="flex items-end"><SubmitButton>{t(locale, "profile.save")}</SubmitButton></div>
      </form>
    </div>
  );
}
