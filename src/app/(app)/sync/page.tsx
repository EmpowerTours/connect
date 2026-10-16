import Link from "next/link";
import { BadgeCheck, Braces, ExternalLink, Fingerprint, Info } from "lucide-react";
import { GraphRow } from "@/components/graph-row";
import { GraphSignButton } from "@/components/graph-sign-button";
import { Columns, PageHeader } from "@/components/layout";
import { getLocale, requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { graphLabels } from "@/lib/graph/labels";
import { pendingFor, rowToEvent } from "@/lib/graph/server";
import { verifyGraphEvent } from "@/lib/graph/verify";
import { t } from "@/lib/i18n";
import { shortAddress } from "@/lib/mera/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Your portable graph" };

export default async function SyncPage() {
  const user = await requireUser();
  const locale = await getLocale();
  const pending = await pendingFor(user);
  const wallet = pending?.wallet ?? null;
  const [signedCount, recentRows] = wallet
    ? await Promise.all([
        prisma.graphEvent.count({ where: { author: wallet } }),
        prisma.graphEvent.findMany({ where: { author: wallet }, orderBy: { seq: "desc" }, take: 8 }),
      ])
    : [0, []];
  const recent = await Promise.all(recentRows.map(async (r) => ({ e: rowToEvent(r), ok: (await verifyGraphEvent(rowToEvent(r))).ok })));
  const labels = await graphLabels([...(pending?.ops ?? []), ...recent.map((r) => r.e)]);
  const ops = pending?.ops ?? [];
  const publicId = user.handle;

  return (
    <Columns>
      <PageHeader title={t(locale, "graph.mine.title")} subtitle={t(locale, "graph.mine.subtitle")} back="/more" />
      <div className="space-y-4 px-4 py-5">
        <p className="px-1 text-[14.5px] leading-relaxed text-muted">{t(locale, "graph.mine.intro")}</p>

        {!wallet ? (
          <div className="glass p-5 text-center">
            <Fingerprint size={28} className="mx-auto text-accent" />
            <p className="mt-2 font-semibold">{t(locale, "graph.mine.needWallet")}</p>
            <Link href={`/u/${user.handle}`} className="btn-primary mt-4">{t(locale, "import.wallet.linkNow")}</Link>
          </div>
        ) : (
          <>
            <section className="glass flex items-center gap-3 p-4" data-testid="graph-status">
              <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-accent-soft text-accent-ink"><BadgeCheck size={20} /></span>
              <div className="min-w-0 flex-1">
                <p className="text-[15px] font-semibold">{t(locale, "graph.mine.signedN").replace("{n}", String(signedCount))}</p>
                <p className="truncate font-mono text-[12px] text-faint">{shortAddress(wallet)} · Monad (143)</p>
              </div>
              <Link href={`/graph/${publicId}`} className="btn-secondary h-9 shrink-0 text-[13px]">
                {t(locale, "graph.mine.public")} <ExternalLink size={13} />
              </Link>
            </section>

            <section className="glass overflow-hidden p-1.5" data-testid="graph-pending">
              <div className="flex items-baseline justify-between px-3 pb-1 pt-2.5">
                <h2 className="text-[16px] font-semibold tracking-tight">{t(locale, "graph.mine.pending")}</h2>
                <span className="text-[13px] font-semibold text-accent-ink">{ops.length}</span>
              </div>
              {ops.length === 0 ? (
                <p className="px-3 pb-3 text-[13.5px] text-muted">{t(locale, "graph.mine.upToDate")}</p>
              ) : (
                <ul className="divide-y divide-line/70">
                  {ops.slice(0, 30).map((o, i) => (
                    <li key={i}>
                      <GraphRow locale={locale} mode="pending" action={o.action} subject={labels.party(o.subject)} object={labels.party(o.object)} orgName={labels.org(o.ref)} />
                    </li>
                  ))}
                  {ops.length > 30 && <li className="px-3.5 py-2.5 text-[13px] text-faint">+{ops.length - 30}</li>}
                </ul>
              )}
              {(pending!.skipped.follows > 0 || pending!.skipped.intros > 0) && (
                <p className="mx-3 mb-2 mt-1 flex items-start gap-1.5 rounded-xl bg-raised px-3 py-2 text-[12.5px] text-muted">
                  <Info size={13} className="mt-0.5 shrink-0" />
                  {t(locale, "graph.mine.skipped").replace("{n}", String(pending!.skipped.follows + pending!.skipped.intros))}
                </p>
              )}
              <div className="p-2">
                <GraphSignButton
                  count={ops.length}
                  label={ops.length ? t(locale, "graph.mine.sign").replace("{n}", String(ops.length)) : t(locale, "graph.mine.nothing")}
                  working={t(locale, "login.mera.working")}
                />
                <p className="mt-2 text-center text-[12px] text-faint">{t(locale, "graph.mine.signNote")}</p>
              </div>
            </section>

            {recent.length > 0 && (
              <section className="glass overflow-hidden p-1.5">
                <h2 className="px-3 pb-1 pt-2.5 text-[16px] font-semibold tracking-tight">{t(locale, "graph.mine.recent")}</h2>
                <ul className="divide-y divide-line/70">
                  {recent.map(({ e, ok }) => (
                    <li key={e.id}>
                      <GraphRow locale={locale} mode="log" action={e.action} author={labels.party(e.author)!} subject={labels.party(e.subject)} object={labels.party(e.object)} orgName={labels.org(e.ref)} seq={e.seq} issuedAt={e.issuedAt} valid={ok} />
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <a href={`/api/graph/users/${publicId}`} className="flex items-center gap-2 px-2 text-[13px] font-semibold text-accent">
              <Braces size={14} /> {t(locale, "graph.mine.json")}
            </a>
          </>
        )}
      </div>
    </Columns>
  );
}
