import Link from "next/link";
import { Lock } from "lucide-react";
import { Kanban, type KanbanCard } from "@/components/kanban";
import { DueChip, Section } from "@/components/ui";
import { getLocale, getWorkspace, requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { t } from "@/lib/i18n";
import { parseList } from "@/lib/json";
import { ACTIVE_STAGES, competingChainMap, dueStatus, isStage, needsAttention, stageCounts } from "@/lib/pipeline";

export const dynamic = "force-dynamic";

export default async function PipelinePage() {
  const user = await requireUser();
  const locale = await getLocale();
  const ws = await getWorkspace(user.id);
  const deals = await prisma.deal.findMany({
    where: { workspaceId: ws.id },
    include: { org: true, contacts: true },
    orderBy: { updatedAt: "desc" },
  });
  const now = new Date();
  const cards: KanbanCard[] = deals.map((d) => ({
    id: d.id,
    stage: isStage(d.stage) ? d.stage : "awareness",
    orgName: d.org.name,
    orgSlug: d.org.slug,
    orgType: d.org.type,
    useCase: d.useCase,
    nextAction: d.nextAction,
    due: d.nextActionDue?.toISOString() ?? null,
    dueStatus: dueStatus(d.nextActionDue, now),
    competing: parseList(d.competingChains),
    contacts: d.contacts.length,
    champion: d.contacts.find((c) => c.isChampion)?.name ?? null,
  }));
  const attention = needsAttention(deals, now);
  const competing = competingChainMap(deals);
  const counts = stageCounts(deals);

  return (
    <div className="space-y-6 px-4 py-5 md:px-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">{t(locale, "nav.deals")} <span className="inline-flex items-center gap-1 rounded-full border border-line px-2 py-0.5 text-xs font-medium text-faint"><Lock size={11} /> {t(locale, "pipeline.private")}</span></h1>
          <p className="mt-1 flex flex-wrap gap-3 text-sm text-muted">
            {ACTIVE_STAGES.map((s) => (
              <span key={s}>
                {t(locale, `stage.${s}`)} <b className="text-fg">{counts[s]}</b>
              </span>
            ))}
          </p>
        </div>
        <Link href="/orgs" className="btn-secondary">+ {t(locale, "pipeline.addFromDirectory")}</Link>
      </div>

      <Kanban cards={cards} locale={locale} />

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title={`${t(locale, "pipeline.attention")} (${attention.length})`}>
          <p className="mb-3 text-xs text-faint">{t(locale, "pipeline.attentionHint")}</p>
          <ul className="divide-y divide-line">
            {attention.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                <Link href={`/orgs/${d.org.slug}?tab=deal`} className="font-medium hover:text-accent">{d.org.name}</Link>
                <span className="flex items-center gap-2 truncate text-xs text-muted">
                  <span className="hidden truncate sm:inline">{d.nextAction || "—"}</span>
                  <DueChip status={dueStatus(d.nextActionDue, now)} date={d.nextActionDue} locale={locale} />
                </span>
              </li>
            ))}
            {attention.length === 0 && <li className="py-2 text-sm text-faint">✓</li>}
          </ul>
        </Section>
        <Section title={t(locale, "pipeline.competing")}>
          {competing.length === 0 ? (
            <p className="text-sm text-faint">{t(locale, "pipeline.noCompeting")}</p>
          ) : (
            <ul className="space-y-2">
              {competing.map((c) => (
                <li key={c.chain} className="text-sm">
                  <span className="chip mr-2 border-red-300 text-red-700">{c.chain}</span>
                  <span className="text-fg/90">{c.orgs.join(", ")}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </div>
  );
}
