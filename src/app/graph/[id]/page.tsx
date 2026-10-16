import { notFound } from "next/navigation";
import { Braces, Building2, Handshake, Users } from "lucide-react";
import { UserAvatar } from "@/components/avatar";
import { GraphRow } from "@/components/graph-row";
import { Columns, PageHeader } from "@/components/layout";
import { getLocale } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { graphLabels } from "@/lib/graph/labels";
import { listEvents, PAGE_DEFAULT, resolveWallet, userGraph } from "@/lib/graph/public";
import { t } from "@/lib/i18n";
import { shortAddress } from "@/lib/mera/format";

export const dynamic = "force-dynamic";

/** Public: one member's graph, rebuilt from their signed updates alone. */
export default async function MemberGraphPage({ params }: { params: Promise<{ id: string }> }) {
  const locale = await getLocale();
  const who = await resolveWallet((await params).id);
  if (!who) notFound();
  const [graph, { events }, signedCount] = await Promise.all([
    userGraph(who.wallet),
    listEvents({ cursor: 0, limit: PAGE_DEFAULT, author: who.wallet }),
    prisma.graphEvent.count({ where: { author: who.wallet } }),
  ]);
  const labels = await graphLabels(events);
  const tag = (p: { wallet: string; handle: string | null }) => (p.handle ? `@${p.handle}` : shortAddress(p.wallet));
  const stat = "glass rounded-[20px]! px-3 py-3";
  return (
    <Columns>
      <PageHeader title={who.name ?? shortAddress(who.wallet)} subtitle={`${who.handle ? `@${who.handle} · ` : ""}${shortAddress(who.wallet)}`} back="/graph" />
      <div className="space-y-4 px-4 py-5">
        <div className="flex items-center gap-3 px-1">
          <UserAvatar name={who.name ?? who.wallet} seed={who.handle ?? who.wallet} size={48} />
          <p className="text-[13.5px] text-muted">{t(locale, "graph.member.intro")}</p>
        </div>
        <section className="grid grid-cols-3 gap-2" data-testid="graph-member-stats">
          <div className={stat}><Users size={15} className="text-accent" /><p className="mt-1 text-[20px] font-semibold">{graph.following.length}</p><p className="text-[11.5px] text-faint">{t(locale, "graph.member.following")}</p></div>
          <div className={stat}><Users size={15} className="text-accent" /><p className="mt-1 text-[20px] font-semibold">{graph.followers.length}</p><p className="text-[11.5px] text-faint">{t(locale, "graph.member.followers")}</p></div>
          <div className={stat}><Handshake size={15} className="text-accent" /><p className="mt-1 text-[20px] font-semibold">{graph.intros.length}</p><p className="text-[11.5px] text-faint">{t(locale, "graph.member.intros")}</p></div>
        </section>
        {(graph.memberships.length > 0 || graph.pendingClaims.length > 0) && (
          <section className="glass space-y-2 p-4">
            {graph.memberships.map((m) => (
              <p key={m.org} className="flex items-center gap-2 text-[14px]">
                <Building2 size={15} className="text-accent" />
                <span className="font-semibold">{labels.org(`org:${m.org}`) ?? m.org}</span>
                <span className="ml-auto rounded-full bg-accent-soft px-2 py-0.5 text-[11.5px] font-semibold text-accent-ink">{t(locale, "graph.member.approvedBy").replace("{who}", tag(m.approvedBy))}</span>
              </p>
            ))}
            {graph.pendingClaims.map((o) => (
              <p key={o} className="flex items-center gap-2 text-[14px] text-muted">
                <Building2 size={15} /> {labels.org(`org:${o}`) ?? o}
                <span className="ml-auto rounded-full bg-raised px-2 py-0.5 text-[11.5px] font-semibold">{t(locale, "graph.member.claimOnly")}</span>
              </p>
            ))}
          </section>
        )}
        <section className="glass overflow-hidden p-1.5">
          <h2 className="px-3 pb-1 pt-2.5 text-[15px] font-semibold">{t(locale, "graph.member.signed").replace("{n}", String(signedCount))}</h2>
          <ul className="divide-y divide-line/70">
            {events.map((e) => (
              <li key={e.id}>
                <GraphRow locale={locale} mode="log" action={e.action} author={labels.party(e.author)!} subject={labels.party(e.subject)} object={labels.party(e.object)} orgName={labels.org(e.ref)} seq={e.seq} issuedAt={e.issuedAt} valid={e.valid} />
              </li>
            ))}
          </ul>
        </section>
        <a href={`/api/graph/users/${who.handle ?? who.wallet}`} className="flex items-center gap-2 px-2 text-[13px] font-semibold text-accent"><Braces size={14} /> GET /api/graph/users/{who.handle ?? who.wallet}</a>
      </div>
    </Columns>
  );
}
