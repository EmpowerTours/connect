"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Compass, Hash, Handshake, Home, KanbanSquare, Landmark, Lock, Newspaper, Radio, UserRound, Users } from "lucide-react";
import { t, type Locale } from "@/lib/i18n";

const PRIMARY = [
  { href: "/", key: "nav.today", icon: Home, match: (p: string) => p === "/" },
  { href: "/opportunities", key: "nav.opportunities", icon: Compass, match: (p: string) => p.startsWith("/opportunities") },
  { href: "/circle", key: "nav.circle", icon: Users, match: (p: string) => p.startsWith("/circle") },
] as const;

/** Floating, minimal three-tab bar (mobile). */
export function TabBar({ locale }: { locale: Locale }) {
  const path = usePathname();
  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-[max(14px,env(safe-area-inset-bottom))] z-40 mx-auto flex h-[64px] w-[min(88%,340px)] items-center justify-around rounded-full border border-white/80 bg-white/75 px-3 shadow-[0_12px_40px_-12px_rgb(76_29_149/0.28),0_1px_2px_rgb(23_21_31/0.06)] backdrop-blur-2xl md:hidden"
    >
      {PRIMARY.map(({ href, key, icon: Icon, match }) => {
        const active = match(path);
        return (
          <Link
            key={href}
            href={href}
            aria-label={t(locale, key)}
            aria-current={active ? "page" : undefined}
            className={`relative flex h-12 w-16 flex-col items-center justify-center rounded-full transition active:scale-95 ${active ? "text-accent" : "text-faint hover:text-muted"}`}
          >
            <span className={`inline-flex h-10 w-10 items-center justify-center rounded-full transition ${active ? "bg-accent-soft" : ""}`}>
              <Icon size={22} strokeWidth={active ? 2.3 : 1.9} />
            </span>
            <span className={`absolute -bottom-0.5 h-1 w-1 rounded-full bg-accent transition ${active ? "opacity-100" : "opacity-0"}`} />
          </Link>
        );
      })}
    </nav>
  );
}

/** Desktop side rail: three primary destinations, then quieter secondary links. */
export function RailNav({ locale, handle, pendingIntros }: { locale: Locale; handle: string; pendingIntros: number }) {
  const path = usePathname();
  const secondary = [
    { href: "/intros", label: t(locale, "nav.intros"), icon: Handshake, badge: pendingIntros, match: (p: string) => p.startsWith("/intros") },
    { href: "/pipeline", label: t(locale, "nav.deals"), icon: KanbanSquare, private: true, match: (p: string) => p.startsWith("/pipeline") },
    { href: "/updates", label: t(locale, "nav.updates"), icon: Newspaper, match: (p: string) => p.startsWith("/updates") || p.startsWith("/post") || p.startsWith("/compose") },
    { href: "/channels", label: t(locale, "nav.channels"), icon: Hash, match: (p: string) => p.startsWith("/channels") },
    { href: "/orgs", label: t(locale, "nav.orgs"), icon: Landmark, match: (p: string) => p.startsWith("/orgs") },
    { href: "/signals", label: t(locale, "nav.signals"), icon: Radio, match: (p: string) => p.startsWith("/signals") },
  ];
  return (
    <div className="flex w-full flex-col gap-6">
      <ul className="flex flex-col gap-1">
        {PRIMARY.map(({ href, key, icon: Icon, match }) => {
          const active = match(path);
          return (
            <li key={href}>
              <Link
                href={href}
                title={t(locale, key)}
                className={`flex items-center gap-3 rounded-2xl px-3 py-2.5 text-[15px] transition ${active ? "bg-white font-semibold text-accent-ink shadow-[0_1px_2px_rgb(23_21_31/0.05),0_6px_18px_-10px_rgb(76_29_149/0.35)]" : "text-muted hover:bg-white/60 hover:text-fg"}`}
              >
                <Icon size={20} strokeWidth={active ? 2.3 : 1.9} className={active ? "text-accent" : ""} />
                <span className="hidden lg:inline">{t(locale, key)}</span>
              </Link>
            </li>
          );
        })}
      </ul>
      <div>
        <p className="eyebrow mb-2 hidden px-3 lg:block">{t(locale, "nav.more")}</p>
        <ul className="flex flex-col gap-0.5">
          {secondary.map(({ href, label, icon: Icon, badge, match, private: isPrivate }) => {
            const active = match(path);
            return (
              <li key={href}>
                <Link
                  href={href}
                  title={label}
                  className={`flex items-center gap-3 rounded-xl px-3 py-2 text-[14px] transition ${active ? "bg-white/80 font-semibold text-fg" : "text-muted hover:bg-white/60 hover:text-fg"}`}
                >
                  <span className="relative">
                    <Icon size={17} strokeWidth={1.9} />
                    {!!badge && <span className="absolute -right-1.5 -top-1 h-2 w-2 rounded-full bg-accent ring-2 ring-bg lg:hidden" />}
                  </span>
                  <span className="hidden lg:inline">{label}</span>
                  {!!badge && (
                    <span className="ml-auto hidden h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1.5 text-[11px] font-semibold text-white lg:inline-flex">{badge}</span>
                  )}
                  {isPrivate && <Lock size={12} className="ml-auto hidden text-faint lg:inline" />}
                </Link>
              </li>
            );
          })}
          <li>
            <Link
              href={`/u/${handle}`}
              className={`flex items-center gap-3 rounded-xl px-3 py-2 text-[14px] transition ${path === `/u/${handle}` || path.startsWith("/profile") ? "bg-white/80 font-semibold text-fg" : "text-muted hover:bg-white/60 hover:text-fg"}`}
            >
              <UserRound size={17} strokeWidth={1.9} />
              <span className="hidden lg:inline">{t(locale, "nav.profile")}</span>
            </Link>
          </li>
        </ul>
      </div>
    </div>
  );
}
