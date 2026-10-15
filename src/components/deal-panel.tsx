import Link from "next/link";
import {
  addAdvisorAction,
  addContactAction,
  generateScoutAction,
  logActivityAction,
  moveDealFormAction,
  removeAdvisorAction,
  removeContactAction,
  updateDealAction,
  updateOrgAction,
} from "@/app/actions";
import { CopyButton } from "@/components/copy-button";
import { DraftPendingSkeleton } from "./pending-skeleton";
import { SubmitButton } from "@/components/submit-button";
import { DueChip, Section, StageDot, timeAgo } from "@/components/ui";
import { ACTIVITY_KINDS, ADVISOR_INFLUENCE, ORG_TYPES } from "@/lib/constants";
import { prisma } from "@/lib/db";
import { ORG_TYPE_LABELS, t, type Locale } from "@/lib/i18n";
import { parseList } from "@/lib/json";
import { STAGES, canTransition, dueStatus, isStage } from "@/lib/pipeline";
import type { Prisma } from "@prisma/client";

const dateInput = (d: Date | null) =>
  d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}` : "";

type Org = Prisma.OrganizationGetPayload<object>;
type Deal = Prisma.DealGetPayload<{
  include: { contacts: true; advisors: { include: { advisorOrg: true } }; activities: { include: { user: true } } };
}>;
type Draft = Prisma.ScoutDraftGetPayload<object>;

/** Facts editor (shared, public data). */
export function OrgFacts({ org, locale }: { org: Org; locale: Locale }) {
  const chainsInUse = parseList(org.chainsInUse);
  const chainsEval = parseList(org.chainsEvaluating);
  const unknown = <span className="text-faint">{t(locale, "org.unknown")}</span>;
  return (
    <Section title={t(locale, "org.facts")}>
            <dl className="grid grid-cols-1 gap-x-4 gap-y-1 text-sm sm:grid-cols-[auto_1fr] sm:gap-y-2">
              <dt className="text-faint">{t(locale, "org.chainsInUse")}</dt>
              <dd className="flex flex-wrap gap-1">{chainsInUse.length ? chainsInUse.map((c) => <span key={c} className="chip">{c}</span>) : unknown}</dd>
              <dt className="text-faint">{t(locale, "org.chainsEvaluating")}</dt>
              <dd className="flex flex-wrap gap-1">{chainsEval.length ? chainsEval.map((c) => <span key={c} className="chip">{c}</span>) : unknown}</dd>
              <dt className="text-faint">{t(locale, "org.notes")}</dt>
              <dd className="whitespace-pre-wrap text-fg/90">{org.notes || unknown}</dd>
            </dl>
            <details className="mt-3">
              <summary className="cursor-pointer text-xs text-accent">{t(locale, "org.edit")}</summary>
              <form action={updateOrgAction} className="mt-3 grid gap-2 sm:grid-cols-2">
                <input type="hidden" name="orgId" value={org.id} />
                <label className="text-xs text-muted">{t(locale, "org.type")}
                  <select name="type" defaultValue={org.type} className="input mt-1">
                    {ORG_TYPES.map((ty) => <option key={ty} value={ty}>{ORG_TYPE_LABELS[locale][ty]}</option>)}
                  </select>
                </label>
                <label className="text-xs text-muted">{t(locale, "org.country")} (ISO-2)
                  <input name="country" defaultValue={org.country} maxLength={2} className="input mt-1" />
                </label>
                <label className="text-xs text-muted sm:col-span-2">{t(locale, "org.website")}
                  <input name="website" defaultValue={org.website} className="input mt-1" />
                </label>
                <label className="text-xs text-muted">{t(locale, "org.chainsInUse")}
                  <input name="chainsInUse" defaultValue={chainsInUse.join(", ")} className="input mt-1" />
                </label>
                <label className="text-xs text-muted">{t(locale, "org.chainsEvaluating")}
                  <input name="chainsEvaluating" defaultValue={chainsEval.join(", ")} className="input mt-1" />
                </label>
                <label className="text-xs text-muted sm:col-span-2">{t(locale, "org.aliases")}
                  <input name="aliases" defaultValue={parseList(org.aliases).join(", ")} className="input mt-1" />
                </label>
                <label className="text-xs text-muted sm:col-span-2">{t(locale, "org.notes")}
                  <textarea name="notes" defaultValue={org.notes} rows={3} className="input mt-1" />
                </label>
                <div className="sm:col-span-2"><SubmitButton>{t(locale, "org.save")}</SubmitButton></div>
              </form>
            </details>
          </Section>
  );
}

/** Private: your deal + AI scout for this org. Only the owner's workspace data is shown. */
export function PrivateDealPanel({ org, deal, drafts, locale, providerName, scoutError }: { org: Org; deal: Deal; drafts: Draft[]; locale: Locale; providerName: string; scoutError?: string }) {
  const renderDraft = (d: (typeof drafts)[number]) => (
                <article key={d.id} className="rounded-lg border border-line bg-raised p-3">
                  <div className="mb-2 flex items-center justify-between text-xs text-faint">
                    <span>{d.provider} · {d.locale.toUpperCase()} · {timeAgo(d.createdAt, locale)}</span>
                    <CopyButton text={`${d.subject}\n\n${d.draft}`} label={locale === "es" ? "Copiar" : "Copy"} done={locale === "es" ? "Copiado" : "Copied"} />
                  </div>
                  <h4 className="label">{t(locale, "scout.fit")}</h4>
                  <p className="mb-3 text-sm text-fg/90">{d.fit}</p>
                  <h4 className="label">{t(locale, "scout.angles")}</h4>
                  <ul className="mb-3 list-inside list-disc text-sm text-fg/90">
                    {parseList(d.angles).map((a) => <li key={a}>{a}</li>)}
                  </ul>
                  <h4 className="label">{t(locale, "scout.subject")}</h4>
                  <p className="mb-3 text-sm font-medium">{d.subject}</p>
                  <h4 className="label">{t(locale, "scout.draft")}</h4>
                  <pre className="whitespace-pre-wrap rounded-md bg-panel p-3 font-sans text-sm text-fg">{d.draft}</pre>
                </article>
  );
  return (
    <div className="space-y-4">
            <Section
              title={t(locale, "deal.title")}
              right={
                <span className="flex items-center gap-2 text-sm">
                  <StageDot stage={isStage(deal.stage) ? deal.stage : "awareness"} />
                  {isStage(deal.stage) && t(locale, `stage.${deal.stage}`)}
                </span>
              }
            >
              <form action={moveDealFormAction} className="mb-4 flex flex-wrap gap-1">
                <input type="hidden" name="dealId" value={deal.id} />
                {STAGES.map((s) => {
                  const allowed = isStage(deal.stage) && canTransition(deal.stage, s);
                  const current = deal.stage === s;
                  return (
                    <button
                      key={s}
                      name="stage"
                      value={s}
                      disabled={!allowed}
                      className={`chip ${current ? "border-accent bg-accent-soft text-white" : allowed ? "hover:border-zinc-400" : "opacity-40"}`}
                    >
                      {t(locale, `stage.${s}`)}
                    </button>
                  );
                })}
              </form>
              <form action={updateDealAction} className="grid gap-2 sm:grid-cols-2">
                <input type="hidden" name="dealId" value={deal.id} />
                <label className="text-xs text-muted sm:col-span-2">{t(locale, "deal.useCase")}
                  <input name="useCase" defaultValue={deal.useCase} className="input mt-1" />
                </label>
                <label className="text-xs text-muted">{t(locale, "deal.nextAction")}
                  <input name="nextAction" defaultValue={deal.nextAction} className="input mt-1" />
                </label>
                <label className="text-xs text-muted">{t(locale, "deal.due")}
                  <input name="nextActionDue" type="date" defaultValue={dateInput(deal.nextActionDue)} className="input mt-1" />
                </label>
                <label className="text-xs text-muted sm:col-span-2">{t(locale, "deal.competing")}
                  <input name="competingChains" defaultValue={parseList(deal.competingChains).join(", ")} placeholder="e.g. Solana, Avalanche" className="input mt-1" />
                </label>
                {deal.stage === "lost" && (
                  <label className="text-xs text-muted sm:col-span-2">{t(locale, "deal.lostReason")}
                    <input name="lostReason" defaultValue={deal.lostReason} className="input mt-1" />
                  </label>
                )}
                <div className="flex items-center gap-2 sm:col-span-2">
                  <SubmitButton>{t(locale, "deal.save")}</SubmitButton>
                  <DueChip status={dueStatus(deal.nextActionDue)} date={deal.nextActionDue} locale={locale} />
                </div>
              </form>

              <h3 className="mb-2 mt-5 text-xs font-semibold uppercase tracking-wide text-muted">{t(locale, "deal.contacts")}</h3>
              <ul className="mb-2 space-y-1">
                {deal.contacts.map((c) => (
                  <li key={c.id} className="flex items-center justify-between gap-2 text-sm">
                    <span>
                      {c.isChampion && <span className="mr-1 text-green-700">★</span>}
                      {c.name} <span className="text-faint">{c.title}</span>
                    </span>
                    <form action={removeContactAction}>
                      <input type="hidden" name="dealId" value={deal.id} />
                      <input type="hidden" name="id" value={c.id} />
                      <button className="text-xs text-faint hover:text-red-700">{t(locale, "deal.remove")}</button>
                    </form>
                  </li>
                ))}
                {deal.contacts.length === 0 && <li className="text-sm text-faint">{t(locale, "deal.none")}</li>}
              </ul>
              <form action={addContactAction} className="flex flex-wrap gap-2">
                <input type="hidden" name="dealId" value={deal.id} />
                <input name="name" required placeholder={t(locale, "contact.name")} className="input flex-1 basis-32" />
                <input name="title" placeholder={t(locale, "contact.title")} className="input flex-1 basis-32" />
                <label className="flex items-center gap-1 text-xs text-muted">
                  <input type="checkbox" name="isChampion" /> {t(locale, "deal.champion")}
                </label>
                <button className="btn-secondary">+</button>
              </form>

              <h3 className="mb-2 mt-5 text-xs font-semibold uppercase tracking-wide text-muted">{t(locale, "deal.advisors")}</h3>
              <ul className="mb-2 space-y-1">
                {deal.advisors.map((a) => (
                  <li key={a.id} className="flex items-center justify-between gap-2 text-sm">
                    <span>
                      {a.name}{" "}
                      {a.advisorOrg ? (
                        <Link href={`/orgs/${a.advisorOrg.slug}`} className="text-accent">{a.firm}</Link>
                      ) : (
                        <span className="text-faint">{a.firm}</span>
                      )}{" "}
                      <span className={`chip ${a.influence === "high" ? "border-amber-300 text-amber-800" : ""}`}>{a.influence}</span>
                    </span>
                    <form action={removeAdvisorAction}>
                      <input type="hidden" name="dealId" value={deal.id} />
                      <input type="hidden" name="id" value={a.id} />
                      <button className="text-xs text-faint hover:text-red-700">{t(locale, "deal.remove")}</button>
                    </form>
                  </li>
                ))}
                {deal.advisors.length === 0 && <li className="text-sm text-faint">{t(locale, "deal.none")}</li>}
              </ul>
              <form action={addAdvisorAction} className="flex flex-wrap gap-2">
                <input type="hidden" name="dealId" value={deal.id} />
                <input name="name" required placeholder={t(locale, "contact.name")} className="input flex-1 basis-28" />
                <input name="firm" placeholder={t(locale, "deal.firm")} list="advisor-firms" className="input flex-1 basis-28" />
                <select name="influence" defaultValue="medium" className="input w-28">
                  {ADVISOR_INFLUENCE.map((i) => <option key={i} value={i}>{i}</option>)}
                </select>
                <button className="btn-secondary">+</button>
              </form>
              <AdvisorFirms />

              <h3 className="mb-2 mt-5 text-xs font-semibold uppercase tracking-wide text-muted">{t(locale, "deal.activity")}</h3>
              <form action={logActivityAction} className="mb-3 flex gap-2">
                <input type="hidden" name="dealId" value={deal.id} />
                <select name="kind" className="input w-28" defaultValue="note">
                  {ACTIVITY_KINDS.filter((k) => k !== "stage_change" && k !== "scout").map((k) => <option key={k} value={k}>{k}</option>)}
                </select>
                <input name="body" required placeholder="…" className="input flex-1" />
                <button className="btn-secondary">{t(locale, "deal.logActivity")}</button>
              </form>
              <ol className="space-y-2 border-l border-line pl-3">
                {deal.activities.map((a) => (
                  <li key={a.id} className="text-sm">
                    <span className="chip mr-2 text-[10px]">{a.kind}</span>
                    {a.body}
                    <span className="ml-2 text-xs text-faint">{timeAgo(a.createdAt, locale)}</span>
                  </li>
                ))}
              </ol>
            </Section>
          <Section
            title={`✦ ${t(locale, "scout.title")}`}
            right={<span className="chip text-[10px]">{t(locale, "scout.provider")}: {providerName}</span>}
          >
            <form key={locale} action={generateScoutAction} className="flex flex-wrap items-center gap-2">
              <input type="hidden" name="orgId" value={org.id} />
              <select name="locale" defaultValue={locale} className="input w-24">
                <option value="en">EN</option>
                <option value="es">ES</option>
              </select>
              <SubmitButton>{t(locale, "scout.generate")}</SubmitButton>
              <div className="basis-full">
                <DraftPendingSkeleton label={t(locale, "introModal.drafting")} />
              </div>
            </form>
            {scoutError && <p className="mt-2 text-sm text-red-700">Scout provider error — check server logs / API key.</p>}
            {providerName === "mock" && <p className="mt-2 text-xs text-faint">{t(locale, "scout.mockNote")}</p>}
            <div className="mt-4 space-y-4">
              {drafts.length === 0 && <p className="text-sm text-faint">{t(locale, "scout.empty")}</p>}
              {drafts.slice(0, 1).map((d) => renderDraft(d))}
              {drafts.length > 1 && (
                <details>
                  <summary className="cursor-pointer text-xs text-faint">{locale === "es" ? "Borradores anteriores" : "Earlier drafts"} ({drafts.length - 1})</summary>
                  <div className="mt-3 space-y-3 opacity-70">{drafts.slice(1).map((d) => renderDraft(d))}</div>
                </details>
              )}
            </div>
          </Section>
    </div>
  );
}

async function AdvisorFirms() {
  const firms = await prisma.organization.findMany({ where: { type: "advisor" }, select: { name: true }, orderBy: { name: "asc" } });
  return (
    <datalist id="advisor-firms">
      {firms.map((f) => <option key={f.name} value={f.name} />)}
    </datalist>
  );
}
