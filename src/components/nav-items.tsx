"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Hash, Handshake, Home, KanbanSquare, Lock, UserRound } from "lucide-react";
import { t, type Locale } from "@/lib/i18n";

export function NavItems({ locale, handle, pendingIntros, variant }: { locale: Locale; handle: string; pendingIntros: number; variant: "side" | "bottom" }) {
  const path = usePathname();
  const items = [
    { href: "/", label: t(locale, "nav.home"), icon: Home, match: (p: string) => p === "/" || p.startsWith("/post") },
    { href: "/channels", label: t(locale, "nav.channels"), icon: Hash, match: (p: string) => p.startsWith("/channels") },
    { href: "/intros", label: t(locale, "nav.intros"), icon: Handshake, badge: pendingIntros, match: (p: string) => p.startsWith("/intros") },
    { href: "/pipeline", label: t(locale, "nav.deals"), icon: KanbanSquare, private: true, match: (p: string) => p.startsWith("/pipeline") },
    { href: `/u/${handle}`, label: t(locale, "nav.profile"), icon: UserRound, match: (p: string) => p === `/u/${handle}` || p.startsWith("/profile") },
  ];

  if (variant === "bottom") {
    return (
      <ul className="grid grid-cols-5">
        {items.map(({ href, label, icon: Icon, badge, match }) => {
          const active = match(path);
          return (
            <li key={href}>
              <Link href={href} className={`relative flex flex-col items-center gap-1 pb-2 pt-2.5 text-[10.5px] font-medium transition ${active ? "text-fg" : "text-faint"}`}>
                <Icon size={22} strokeWidth={active ? 2.4 : 1.8} />
                {label}
                {!!badge && <span className="absolute right-[calc(50%-18px)] top-1.5 h-2 w-2 rounded-full bg-accent ring-2 ring-bg" />}
              </Link>
            </li>
          );
        })}
      </ul>
    );
  }
  return (
    <ul className="flex flex-col items-center gap-1 xl:items-stretch">
      {items.map(({ href, label, icon: Icon, badge, match, private: isPrivate }) => {
        const active = match(path);
        return (
          <li key={href}>
            <Link
              href={href}
              title={label}
              className={`group flex items-center gap-4 rounded-2xl px-3 py-2.5 text-[16px] transition hover:bg-white/[0.05] ${active ? "font-bold text-fg" : "text-muted hover:text-fg"}`}
            >
              <span className="relative">
                <Icon size={24} strokeWidth={active ? 2.4 : 1.8} />
                {!!badge && (
                  <span className="absolute -right-2 -top-1.5 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-accent px-1 text-[10px] font-bold text-white ring-2 ring-bg">
                    {badge}
                  </span>
                )}
              </span>
              <span className="hidden xl:inline">{label}</span>
              {isPrivate && <Lock size={13} className="ml-auto hidden text-faint xl:inline" />}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
