import { redirect } from "next/navigation";
import Link from "next/link";
import { ChevronRight, FlaskConical, Fingerprint, Handshake, Hash, KanbanSquare, Lock } from "lucide-react";
import { devLoginAction, setLocaleAction } from "@/app/actions";
import { MeraSignIn } from "@/components/mera-sign-in";
import { devLoginAllowed } from "@/lib/auth-core";
import { getCurrentUser, getLocale } from "@/lib/auth";
import { APP_FULL_NAME, APP_HOST, APP_NAME, BRAND, SOURCE_URL } from "@/lib/brand";
import { t } from "@/lib/i18n";
import { safeNextPath } from "@/lib/links";

export const dynamic = "force-dynamic";
export const metadata = { title: { absolute: APP_FULL_NAME }, alternates: { canonical: "/login" } };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string; next?: string; join?: string }> }) {
  const { error, next: rawNext, join } = await searchParams;
  // Where they were headed (e.g. a shared profile); only same-origin paths survive.
  const next = safeNextPath(rawNext);
  if (await getCurrentUser()) redirect(next ?? "/");
  const locale = await getLocale();
  const points = [
    { icon: Hash, text: t(locale, "login.point1") },
    { icon: Handshake, text: t(locale, "login.point2") },
    { icon: KanbanSquare, text: t(locale, "login.point3") },
  ];
  return (
    <main className="relative flex min-h-dvh justify-center overflow-hidden px-5 pb-10 pt-5 sm:items-center">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(70%_45%_at_50%_0%,rgb(196_181_253/0.55),transparent),radial-gradient(60%_40%_at_100%_100%,rgb(167_139_250/0.25),transparent)]" />
      <div className="relative w-full max-w-[400px]">
        <div className="mb-5 flex items-center justify-between">
          <div className="flex items-center gap-2.5 text-xl font-bold tracking-tight">
            <span className="relative inline-flex h-8 w-8 items-center justify-center rounded-xl bg-accent shadow-[0_6px_16px_-6px_rgb(124_58_237/0.7)]"><span className="h-3 w-3 rounded-full bg-white" /></span>
            {APP_NAME}
          </div>
          <form action={setLocaleAction}>
            <input type="hidden" name="locale" value={locale === "en" ? "es" : "en"} />
            <button className="btn-ghost h-9 px-3 text-xs">{locale === "en" ? "ES" : "EN"}</button>
          </form>
        </div>

        <span className="inline-flex items-center gap-1.5 rounded-full border border-lilac bg-white/70 px-2.5 py-1 text-xs font-semibold text-accent-ink">
          <span className="h-1.5 w-1.5 rounded-full bg-accent" />
          {t(locale, "login.poweredBy")}
        </span>
        <h1 className="mt-3 text-[25px] font-bold leading-[1.15] tracking-tight">{t(locale, "app.tagline")}</h1>
        <ul className="mt-3 space-y-1.5">
          {points.map(({ icon: Icon, text }) => (
            <li key={text} className="flex items-center gap-3 text-[13.5px] leading-snug text-muted">
              <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent"><Icon size={15} /></span>
              {text}
            </li>
          ))}
        </ul>

        <section className="glass mt-5 rounded-3xl border border-white/80 p-5 shadow-[0_20px_50px_-24px_rgb(91_33_182/0.45)]">
          <div className="mb-4 flex items-start gap-3">
            <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-lavender to-accent text-white">
              <Fingerprint size={22} />
            </span>
            <div>
              <h2 className="text-[17px] font-bold leading-tight">{t(locale, "login.mera.title")}</h2>
              <p className="mt-1 text-[13px] leading-snug text-muted">{t(locale, "login.mera.subtitle")}</p>
            </div>
          </div>
          {error === "link" && <p className="mb-3 rounded-xl bg-danger/10 p-2.5 text-sm text-danger">{t(locale, "login.invalid")}</p>}
          <MeraSignIn locale={locale} next={next} join={join === "1"} />
          <div className="mt-4 flex items-start justify-between gap-3 border-t border-line pt-3">
            <p className="flex items-start gap-1.5 text-xs leading-snug text-faint">
              <Lock size={13} className="mt-px shrink-0" />
              {t(locale, "login.mera.note")}
            </p>
            <span className="chip shrink-0 border-lilac text-[11px] text-accent-ink">{t(locale, "login.mera.only")}</span>
          </div>
        </section>

        {devLoginAllowed() && (
          <section className="mt-4 rounded-2xl border border-dashed border-amber-300 bg-amber-50/70 p-4">
            <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-amber-800">
              <FlaskConical size={13} /> {t(locale, "login.demo.title")}
            </p>
            <p className="mt-1 text-xs leading-snug text-amber-900/80">{t(locale, "login.demo.body")}</p>
            <form action={devLoginAction} className="mt-3">
              <button className="btn-secondary h-10 w-full text-sm">{t(locale, "login.dev")}</button>
            </form>
          </section>
        )}

        <Link href="/graph" className="mt-4 flex items-center justify-center gap-1.5 text-[13px] font-semibold text-accent hover:underline">
          {t(locale, "login.explore")} <ChevronRight size={14} />
        </Link>

        <p className="mt-6 text-center text-[11px] text-faint">
          {APP_HOST} · {BRAND.ecosystem} ·{" "}
          <a href={SOURCE_URL} target="_blank" rel="noopener noreferrer" className="hover:underline">
            {t(locale, "login.source")}
          </a>
        </p>
      </div>
    </main>
  );
}
