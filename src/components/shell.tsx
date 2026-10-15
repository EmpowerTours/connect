import Link from "next/link";
import { PenSquare, Search } from "lucide-react";
import { logoutAction, setLocaleAction } from "@/app/actions";
import { APP_NAME } from "@/lib/constants";
import { t, type Locale } from "@/lib/i18n";
import { UserAvatar } from "./avatar";
import { DemoBadge } from "./badges";
import { NavItems } from "./nav-items";

export interface ShellUser {
  name: string;
  handle: string;
  isDemo: boolean;
}

function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <Link href="/" className="flex items-center gap-2.5 rounded-xl px-2 py-1.5 text-[17px] font-bold tracking-tight">
      <span className="relative inline-flex h-7 w-7 items-center justify-center rounded-lg bg-accent">
        <span className="h-2.5 w-2.5 rounded-full bg-white" />
        <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-white/60" />
      </span>
      {!compact && <span className="hidden xl:inline">{APP_NAME}</span>}
    </Link>
  );
}

function LocaleToggle({ locale }: { locale: Locale }) {
  return (
    <form action={setLocaleAction}>
      <input type="hidden" name="locale" value={locale === "en" ? "es" : "en"} />
      <button className="btn-ghost h-9 px-3 text-xs" aria-label="Switch language" title="EN / ES">
        {locale === "en" ? "ES" : "EN"}
      </button>
    </form>
  );
}

export function LeftNav({ locale, user, pendingIntros }: { locale: Locale; user: ShellUser; pendingIntros: number }) {
  return (
    <aside className="sticky top-0 hidden h-dvh w-[76px] shrink-0 flex-col items-center gap-1 border-line px-2 py-4 md:flex xl:w-[248px] xl:items-stretch xl:px-4">
      <Logo />
      <div className="mt-4 w-full">
        <NavItems locale={locale} handle={user.handle} pendingIntros={pendingIntros} variant="side" />
      </div>
      <Link href="/compose" className="btn-primary mt-4 h-11 w-11 p-0 xl:h-11 xl:w-full" aria-label={t(locale, "nav.cast")}>
        <PenSquare size={18} />
        <span className="hidden xl:inline">{t(locale, "nav.cast")}</span>
      </Link>
      <div className="mt-auto flex w-full flex-col items-center gap-2 xl:items-stretch">
        <div className="flex items-center justify-center gap-1 xl:justify-start">
          <LocaleToggle locale={locale} />
          <form action={logoutAction} className="hidden xl:block">
            <button className="btn-ghost h-9 px-3 text-xs">{t(locale, "nav.logout")}</button>
          </form>
        </div>
        <Link href={`/u/${user.handle}`} className="flex items-center gap-3 rounded-2xl p-2 transition hover:bg-white/[0.05]">
          <UserAvatar name={user.name} seed={user.handle} size={36} />
          <span className="hidden min-w-0 xl:block">
            <span className="flex items-center gap-1.5 truncate text-sm font-semibold">
              {user.name} {user.isDemo && <DemoBadge locale={locale} />}
            </span>
            <span className="block truncate text-xs text-faint">@{user.handle}</span>
          </span>
        </Link>
      </div>
    </aside>
  );
}

export function MobileTop({ locale, user }: { locale: Locale; user: ShellUser }) {
  return (
    <header className="sticky top-0 z-40 flex h-14 items-center justify-between border-b border-line bg-bg/80 px-3 backdrop-blur-xl md:hidden">
      <Link href={`/u/${user.handle}`} aria-label={t(locale, "nav.profile")}>
        <UserAvatar name={user.name} seed={user.handle} size={32} />
      </Link>
      <Logo compact />
      <div className="flex items-center">
        <LocaleToggle locale={locale} />
        <Link href="/search" className="btn-ghost h-9 w-9 p-0" aria-label={t(locale, "search.title")}>
          <Search size={19} />
        </Link>
      </div>
    </header>
  );
}

export function MobileTabs({ locale, user, pendingIntros }: { locale: Locale; user: ShellUser; pendingIntros: number }) {
  return (
    <>
      <Link
        href="/compose"
        aria-label={t(locale, "nav.cast")}
        className="fixed bottom-[76px] right-4 z-40 inline-flex h-14 w-14 items-center justify-center rounded-full bg-accent text-white shadow-[0_8px_30px_rgb(124_92_255/0.45)] transition active:scale-95 md:hidden"
      >
        <PenSquare size={22} />
      </Link>
      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-bg/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl md:hidden">
        <NavItems locale={locale} handle={user.handle} pendingIntros={pendingIntros} variant="bottom" />
      </nav>
    </>
  );
}
