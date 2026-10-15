import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";

/** Calm single column for secondary pages (no right rail). */
export function Columns({ children }: { children: ReactNode }) {
  return (
    <div className="flex justify-center md:px-6 md:py-6">
      <main className="min-h-dvh w-full min-w-0 max-w-[680px] bg-white/75 md:min-h-0 md:overflow-hidden md:rounded-[26px] md:border md:border-white/80 md:shadow-[0_1px_2px_rgb(23_21_31/0.04),0_12px_32px_-14px_rgb(76_29_149/0.18)]">
        {children}
      </main>
    </div>
  );
}

/** Container for the three primary tabs. */
export function TabPage({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  return <main className={`mx-auto w-full px-5 pt-4 md:px-8 md:pt-10 ${wide ? "max-w-[760px]" : "max-w-[600px]"}`}>{children}</main>;
}

export function PageHeader({ title, subtitle, back, right, children }: { title: ReactNode; subtitle?: ReactNode; back?: string; right?: ReactNode; children?: ReactNode }) {
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-white/80 backdrop-blur-xl">
      <div className="flex min-h-[53px] items-center gap-3 px-4">
        {back && (
          <Link href={back} className="btn-ghost -ml-2 h-9 w-9 p-0" aria-label="Back">
            <ArrowLeft size={19} />
          </Link>
        )}
        <div className="min-w-0 flex-1 py-2">
          <h1 className="truncate text-[19px] font-semibold leading-tight tracking-tight">{title}</h1>
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
          className={`relative flex flex-1 shrink-0 justify-center whitespace-nowrap px-4 py-3.5 text-[15px] transition hover:bg-black/[0.03] ${tab.active ? "font-semibold text-fg" : "text-faint"}`}
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
