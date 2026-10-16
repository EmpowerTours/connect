import Link from "next/link";
import { Braces, ChevronRight, ShieldCheck, Terminal } from "lucide-react";
import { GraphRow } from "@/components/graph-row";
import { Columns, PageHeader } from "@/components/layout";
import { getLocale } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { graphLabels } from "@/lib/graph/labels";
import { listEvents, PAGE_DEFAULT } from "@/lib/graph/public";
import { t } from "@/lib/i18n";

export const dynamic = "force-dynamic";
export const metadata = { title: "Open graph" };

/** Public explorer for the signed graph. No sign-in. */
export default async function GraphPage({ searchParams }: { searchParams: Promise<{ cursor?: string }> }) {
  const locale = await getLocale();
  const cursor = Math.max(0, Number.parseInt((await searchParams).cursor ?? "0", 10) || 0);
  const [{ events, nextCursor }, total, authors] = await Promise.all([
    listEvents({ cursor, limit: PAGE_DEFAULT }),
    prisma.graphEvent.count(),
    prisma.graphEvent.groupBy({ by: ["author"] }),
  ]);
  const labels = await graphLabels(events);
  const allValid = events.every((e) => e.valid);
  return (
    <Columns>
      <PageHeader title={t(locale, "graph.public.title")} subtitle={t(locale, "graph.public.subtitle")} back="/" />
      <div className="space-y-4 px-4 py-5">
        <p className="px-1 text-[14.5px] leading-relaxed text-muted">{t(locale, "graph.public.intro")}</p>
        <section className="grid grid-cols-3 gap-2" data-testid="graph-stats">
          {[
            { n: total, label: t(locale, "graph.public.updates") },
            { n: authors.length, label: t(locale, "graph.public.wallets") },
            { n: events.length ? (allValid ? "✓" : "!") : "–", label: t(locale, allValid ? "graph.public.allValid" : "graph.public.someInvalid") },
          ].map((s, i) => (
            <div key={i} className="glass rounded-[20px]! px-3 py-3 text-center">
              <p className="text-[22px] font-semibold tracking-tight text-accent-ink">{s.n}</p>
              <p className="text-[11.5px] font-medium text-faint">{s.label}</p>
            </div>
          ))}
        </section>

        <section className="glass overflow-hidden p-1.5">
          {events.length === 0 ? (
            <p className="px-3 py-6 text-center text-[14px] text-muted">{t(locale, "graph.public.empty")}</p>
          ) : (
            <ul className="divide-y divide-line/70">
              {events.map((e) => (
                <li key={e.id}>
                  <GraphRow locale={locale} mode="log" action={e.action} author={labels.party(e.author)!} subject={labels.party(e.subject)} object={labels.party(e.object)} orgName={labels.org(e.ref)} seq={e.seq} issuedAt={e.issuedAt} valid={e.valid} />
                </li>
              ))}
            </ul>
          )}
          {nextCursor && (
            <Link href={`/graph?cursor=${nextCursor}`} className="flex items-center justify-center gap-1 border-t border-line/70 py-3 text-[13px] font-semibold text-accent">
              {t(locale, "graph.public.more")} <ChevronRight size={14} />
            </Link>
          )}
        </section>

        <section className="glass space-y-2.5 p-4" data-testid="graph-verify">
          <h2 className="flex items-center gap-1.5 text-[15px] font-semibold"><ShieldCheck size={16} className="text-accent" /> {t(locale, "graph.public.verifyTitle")}</h2>
          <p className="text-[13.5px] text-muted">{t(locale, "graph.public.verifyBody")}</p>
          <pre className="overflow-x-auto rounded-xl bg-fg px-3 py-2.5 font-mono text-[12px] leading-relaxed text-white"><Terminal size={12} className="mr-1.5 inline text-lilac" />npx tsx scripts/verify-graph.ts --base https://connect.empowertours.xyz</pre>
          <a href="/api/graph/events" className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-accent"><Braces size={14} /> GET /api/graph/events</a>
        </section>
      </div>
    </Columns>
  );
}
