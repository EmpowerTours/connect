"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Fingerprint } from "lucide-react";
import { loginPath } from "@/lib/links";

/**
 * Sign-in and sign-up links that bring the visitor back to the page they are on. Client side
 * because the public layout stays mounted while the visitor moves between profiles and posts.
 */
export function SignInLink({ label, className, join = false }: { label: string; className: string; join?: boolean }) {
  const path = usePathname();
  return (
    <Link href={loginPath(path, { join })} className={className}>
      {label}
    </Link>
  );
}

/** Floating sign-up bar on public pages. Not on "/", whose landing page has its own sign-up buttons. */
export function JoinBar({ title, body, cta }: { title: string; body: string; cta: string }) {
  const path = usePathname();
  if (path === "/") return null;
  return (
    <aside
      data-testid="join-bar"
      className="fixed inset-x-3 bottom-[max(12px,env(safe-area-inset-bottom))] z-40 mx-auto flex max-w-[680px] flex-col gap-3 rounded-[22px] border border-white/80 bg-white/85 p-4 shadow-[0_16px_44px_-16px_rgb(76_29_149/0.35)] backdrop-blur-2xl sm:flex-row sm:items-center"
    >
      <div className="min-w-0 flex-1">
        <p className="text-[15px] font-semibold tracking-tight">{title}</p>
        <p className="mt-0.5 text-[13px] leading-snug text-muted">{body}</p>
      </div>
      <Link href={loginPath(path, { join: true })} className="btn-primary h-11 shrink-0 px-5 text-[14.5px] shadow-[0_10px_24px_-12px_rgb(124_58_237/0.7)]">
        <Fingerprint size={17} /> {cta}
      </Link>
    </aside>
  );
}
