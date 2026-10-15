import Link from "next/link";
import { logoutAction, setLocaleAction } from "@/app/actions";
import { APP_NAME } from "@/lib/constants";
import { t, type Locale } from "@/lib/i18n";
import { UserAvatar } from "./avatar";
import { RailNav } from "./nav-items";

export interface ShellUser {
  name: string;
  handle: string;
  isDemo: boolean;
}

export function LogoMark({ size = 30 }: { size?: number }) {
  return (
    <span
      className="relative inline-flex items-center justify-center rounded-[10px] bg-gradient-to-br from-lavender to-accent shadow-[0_6px_16px_-6px_rgb(124_58_237/0.6)]"
      style={{ width: size, height: size }}
    >
      <span className="h-[34%] w-[34%] rounded-full bg-white" />
      <span className="absolute right-[22%] top-[22%] h-[16%] w-[16%] rounded-full bg-white/70" />
    </span>
  );
}

export function LocaleToggle({ locale, className = "btn-ghost h-9 px-3 text-xs" }: { locale: Locale; className?: string }) {
  return (
    <form action={setLocaleAction}>
      <input type="hidden" name="locale" value={locale === "en" ? "es" : "en"} />
      <button className={className} aria-label="Switch language" title="EN / ES">
        {locale === "en" ? "ES" : "EN"}
      </button>
    </form>
  );
}

/** Slim desktop side rail. Mobile uses the floating TabBar plus the avatar menu (/more). */
export function SideRail({ locale, user, pendingIntros }: { locale: Locale; user: ShellUser; pendingIntros: number }) {
  return (
    <aside className="sticky top-0 hidden h-dvh w-[76px] shrink-0 flex-col items-stretch px-3 py-6 md:flex lg:w-[232px] lg:px-4">
      <Link href="/" className="mb-8 flex items-center gap-2.5 px-2 text-[17px] font-semibold tracking-tight">
        <LogoMark />
        <span className="hidden lg:inline">{APP_NAME}</span>
      </Link>
      <RailNav locale={locale} handle={user.handle} pendingIntros={pendingIntros} />
      <div className="mt-auto flex flex-col gap-2">
        <div className="hidden items-center gap-1 lg:flex">
          <LocaleToggle locale={locale} />
          <form action={logoutAction}>
            <button className="btn-ghost h-9 px-3 text-xs">{t(locale, "nav.logout")}</button>
          </form>
        </div>
        <Link href={`/u/${user.handle}`} className="flex items-center gap-3 rounded-2xl p-1.5 transition hover:bg-white/70">
          <UserAvatar name={user.name} seed={user.handle} size={36} />
          <span className="hidden min-w-0 lg:block">
            <span className="block truncate text-sm font-semibold">{user.name}</span>
            <span className="block truncate text-xs text-faint">@{user.handle}</span>
          </span>
        </Link>
      </div>
    </aside>
  );
}

/** Page top for the three primary tabs: eyebrow label left, avatar menu right (mobile). */
export function TopLine({ eyebrow, user, right }: { eyebrow: string; user: ShellUser; right?: React.ReactNode }) {
  return (
    <div className="flex h-10 items-center justify-between">
      <p className="eyebrow">{eyebrow}</p>
      <div className="flex items-center gap-2">
        {right}
        <Link href="/more" aria-label="Menu" className="rounded-full transition active:scale-95 md:hidden">
          <UserAvatar name={user.name} seed={user.handle} size={34} ring />
        </Link>
      </div>
    </div>
  );
}
