import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";

/** Center column + optional right rail (Warpcast / LinkedIn style). */
export function Columns({ children, rail }: { children: ReactNode; rail?: ReactNode }) {
  return (
    <div className="flex justify-center gap-6 xl:gap-8">
      <main className="min-h-dvh w-full min-w-0 max-w-[640px] border-line md:border-x">{children}</main>
      {rail && <aside className="sticky top-0 hidden h-dvh w-[340px] shrink-0 overflow-y-auto py-4 pr-2 lg:block no-scrollbar">{rail}</aside>}
    </div>
  );
}

export function PageHeader({ title, subtitle, back, right, children }: { title: ReactNode; subtitle?: ReactNode; back?: string; right?: ReactNode; children?: ReactNode }) {
  return (
    <header className="sticky top-14 z-30 border-b border-line bg-bg/80 backdrop-blur-xl md:top-0">
      <div className="flex min-h-[53px] items-center gap-3 px-4">
        {back && (
          <Link href={back} className="btn-ghost -ml-2 h-9 w-9 p-0" aria-label="Back">
            <ArrowLeft size={19} />
          </Link>
        )}
        <div className="min-w-0 flex-1 py-2">
          <h1 className="truncate text-[19px] font-bold leading-tight tracking-tight">{title}</h1>
          {subtitle && <p className="truncate text-[13px] text-faint">{subtitle}</p>}
        </div>
        {right}
      </div>
      {children}
    </header>
  );
}

export function Tabs({ tabs }: { tabs: { href: string; label: ReactNode; active: boolean }[] }) {
  return (
    <nav className="no-scrollbar flex overflow-x-auto">
      {tabs.map((tab) => (
        <Link
          key={tab.href}
          href={tab.href}
          scroll={false}
          className={`relative flex flex-1 shrink-0 justify-center whitespace-nowrap px-4 py-3.5 text-[15px] transition hover:bg-white/[0.03] ${tab.active ? "font-semibold text-fg" : "text-faint"}`}
        >
          {tab.label}
          {tab.active && <span className="absolute bottom-0 h-[3px] w-12 rounded-full bg-accent" />}
        </Link>
      ))}
    </nav>
  );
}

export function RailCard({ title, children, footer }: { title: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <section className="card overflow-hidden">
      <h2 className="px-4 pb-1 pt-3.5 text-[17px] font-bold tracking-tight">{title}</h2>
      {children}
      {footer && <div className="border-t border-line px-4 py-3 text-sm text-accent">{footer}</div>}
    </section>
  );
}
