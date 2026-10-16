import { APP_NAME } from "@/lib/brand";

/**
 * Shared frame for the 404 and error screens: light, minimal, purple accent, and no data
 * fetching or session lookups, so it renders even when the database or auth is the problem.
 */
export function StatusPage({ code, title, body, children }: { code: string; title: string; body: string; children?: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh items-center justify-center px-5 py-16">
      <div className="glass w-full max-w-md p-8 text-center">
        <p className="text-[13px] font-semibold uppercase tracking-[0.14em] text-accent">{APP_NAME}</p>
        <p className="mt-6 text-[56px] font-semibold leading-none tracking-tight text-lilac" aria-hidden>
          {code}
        </p>
        <h1 className="mt-4 text-[22px] font-semibold tracking-tight text-fg">{title}</h1>
        <p className="mx-auto mt-2 max-w-sm text-[14.5px] leading-relaxed text-muted">{body}</p>
        {children && <div className="mt-7 flex flex-wrap items-center justify-center gap-2">{children}</div>}
      </div>
    </main>
  );
}
