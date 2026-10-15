"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function NavLinks({ links, variant }: { links: { href: string; label: string; icon: string }[]; variant: "top" | "bottom" }) {
  const path = usePathname();
  const active = (href: string) => path === href || path.startsWith(`${href}/`) || (href === "/directory" && path.startsWith("/orgs"));
  if (variant === "top") {
    return (
      <ul className="flex gap-1">
        {links.map((l) => (
          <li key={l.href}>
            <Link
              href={l.href}
              className={`rounded-lg px-3 py-1.5 text-sm ${active(l.href) ? "bg-white/10 text-white" : "text-zinc-400 hover:text-white"}`}
            >
              {l.label}
            </Link>
          </li>
        ))}
      </ul>
    );
  }
  return (
    <ul className="grid grid-cols-4">
      {links.map((l) => (
        <li key={l.href}>
          <Link
            href={l.href}
            className={`flex flex-col items-center gap-0.5 py-2 text-[11px] ${active(l.href) ? "text-violet-300" : "text-zinc-400"}`}
          >
            <span className="text-lg leading-none">{l.icon}</span>
            {l.label}
          </Link>
        </li>
      ))}
    </ul>
  );
}
