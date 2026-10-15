import Link from "next/link";
import { redirect } from "next/navigation";
import { Handshake, Hash, KanbanSquare } from "lucide-react";
import { devLoginAction, requestMagicLinkAction, setLocaleAction } from "@/app/actions";
import { devLoginAllowed } from "@/lib/auth-core";
import { getCurrentUser, getLocale } from "@/lib/auth";
import { APP_NAME } from "@/lib/constants";
import { t } from "@/lib/i18n";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ sent?: string; error?: string }> }) {
  if (await getCurrentUser()) redirect("/");
  const { sent, error } = await searchParams;
  const locale = await getLocale();
  const points = [
    { icon: Hash, text: t(locale, "login.point1") },
    { icon: Handshake, text: t(locale, "login.point2") },
    { icon: KanbanSquare, text: t(locale, "login.point3") },
  ];
  return (
    <main className="relative flex min-h-dvh items-center justify-center overflow-hidden px-5 py-10">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_50%_at_50%_0%,rgb(124_92_255/0.25),transparent)]" />
      <div className="relative w-full max-w-[400px]">
        <div className="mb-8 flex items-center justify-between">
          <div className="flex items-center gap-2.5 text-xl font-bold tracking-tight">
            <span className="relative inline-flex h-8 w-8 items-center justify-center rounded-xl bg-accent"><span className="h-3 w-3 rounded-full bg-white" /></span>
            {APP_NAME}
          </div>
          <form action={setLocaleAction}>
            <input type="hidden" name="locale" value={locale === "en" ? "es" : "en"} />
            <button className="btn-ghost h-9 px-3 text-xs">{locale === "en" ? "ES" : "EN"}</button>
          </form>
        </div>
        <h1 className="text-[28px] font-bold leading-tight tracking-tight">{t(locale, "app.tagline")}</h1>
        <ul className="mt-5 space-y-2.5">
          {points.map(({ icon: Icon, text }) => (
            <li key={text} className="flex items-center gap-3 text-[15px] text-muted">
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-accent-soft text-accent"><Icon size={16} /></span>
              {text}
            </li>
          ))}
        </ul>
        <div className="card mt-8 space-y-4 p-5">
          {error === "link" && <p className="rounded-xl bg-danger/10 p-2.5 text-sm text-danger">{t(locale, "login.invalid")}</p>}
          <form action={requestMagicLinkAction} className="space-y-2.5">
            <label className="label" htmlFor="email">{t(locale, "login.email")}</label>
            <input id="email" name="email" type="email" required className="input" placeholder="you@institution.com" />
            <button className="btn-primary h-11 w-full">{t(locale, "login.send")}</button>
          </form>
          <p className="text-xs text-faint">{t(locale, "login.subtitle")}</p>
          {sent && (
            <div className="rounded-xl border border-accent/40 bg-accent-soft p-3 text-sm animate-rise">
              <p className="mb-2 text-fg/90">{t(locale, "login.linkReady")}</p>
              <Link href={`/auth/verify?token=${encodeURIComponent(sent)}`} className="btn-primary w-full">{t(locale, "login.open")} →</Link>
            </div>
          )}
          {devLoginAllowed() && (
            <>
              <div className="flex items-center gap-3 text-xs text-faint"><span className="h-px flex-1 bg-line" />{t(locale, "login.or")}<span className="h-px flex-1 bg-line" /></div>
              <form action={devLoginAction}>
                <button className="btn-secondary h-11 w-full">{t(locale, "login.dev")}</button>
              </form>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
