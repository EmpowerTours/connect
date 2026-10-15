import Link from "next/link";
import { redirect } from "next/navigation";
import { devLoginAction, requestMagicLinkAction, setLocaleAction } from "@/app/actions";
import { devLoginAllowed } from "@/lib/auth-core";
import { getCurrentUser, getLocale } from "@/lib/auth";
import { APP_NAME } from "@/lib/constants";
import { t } from "@/lib/i18n";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ sent?: string; error?: string }> }) {
  if (await getCurrentUser()) redirect("/pipeline");
  const { sent, error } = await searchParams;
  const locale = await getLocale();
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-5 py-10">
      <div className="mb-8">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2 text-xl font-semibold">
            <span className="inline-block h-6 w-6 rounded-md bg-gradient-to-br from-violet-500 to-fuchsia-500" />
            {APP_NAME}
          </div>
          <form action={setLocaleAction}>
            <input type="hidden" name="locale" value={locale === "en" ? "es" : "en"} />
            <button className="btn-ghost px-2 py-1 text-xs">{locale === "en" ? "ES" : "EN"}</button>
          </form>
        </div>
        <p className="text-zinc-400">{t(locale, "app.tagline")}</p>
      </div>
      <div className="card space-y-4 p-5">
        <div>
          <h1 className="text-lg font-semibold">{t(locale, "login.title")}</h1>
          <p className="text-sm text-zinc-400">{t(locale, "login.subtitle")}</p>
        </div>
        {error === "link" && <p className="rounded-lg bg-rose-500/10 p-2 text-sm text-rose-300">{t(locale, "login.invalid")}</p>}
        <form action={requestMagicLinkAction} className="space-y-2">
          <label className="label" htmlFor="email">{t(locale, "login.email")}</label>
          <input id="email" name="email" type="email" required className="input" placeholder="you@institution.com" />
          <button className="btn-primary w-full">{t(locale, "login.send")}</button>
        </form>
        {sent && (
          <div className="rounded-lg border border-violet-500/40 bg-violet-500/10 p-3 text-sm">
            <p className="mb-2 text-zinc-300">{t(locale, "login.linkReady")}</p>
            <Link href={`/auth/verify?token=${encodeURIComponent(sent)}`} className="btn-primary w-full">
              {t(locale, "login.open")} →
            </Link>
          </div>
        )}
        {devLoginAllowed() && (
          <form action={devLoginAction}>
            <button className="btn-ghost w-full">{t(locale, "login.dev")}</button>
          </form>
        )}
      </div>
    </main>
  );
}
