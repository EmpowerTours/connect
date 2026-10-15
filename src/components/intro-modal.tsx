import Link from "next/link";
import { Handshake, Sparkles, Wand2, X } from "lucide-react";
import { draftIntroAction, sendIntroAction } from "@/app/actions";
import { prisma } from "@/lib/db";
import { t, type Locale } from "@/lib/i18n";
import { getScoutProvider } from "@/lib/scout";
import { UserAvatar } from "./avatar";
import { DemoBadge } from "./badges";
import { DraftPendingSkeleton } from "./pending-skeleton";
import { SubmitButton } from "./submit-button";

type Person = { id: string; name: string; handle: string; isDemo: boolean; headline: string; orgName: string };

export async function IntroModal({
  me,
  target,
  mutual,
  introParam,
  error,
  locale,
}: {
  me: { id: string; name: string; handle: string };
  target: Person;
  mutual: Person[];
  introParam: string;
  error?: string;
  locale: Locale;
}) {
  const close = `/u/${target.handle}`;
  const draft =
    introParam !== "1"
      ? await prisma.intro.findFirst({ where: { id: introParam, requesterId: me.id, targetId: target.id, status: "draft" }, include: { connector: true } })
      : null;
  const provider = getScoutProvider().name;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 backdrop-blur-sm animate-fade-in sm:items-start sm:p-4 sm:pt-[8vh]" role="dialog" aria-modal="true" aria-labelledby="intro-title">
      <Link href={close} scroll={false} className="absolute inset-0 cursor-default" aria-label="Close" />
      <div className="relative max-h-[92dvh] w-full overflow-y-auto rounded-t-3xl border border-line-strong bg-surface shadow-2xl animate-rise sm:max-w-[560px] sm:rounded-3xl">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-line bg-surface/95 px-4 py-3 backdrop-blur">
          <Link href={close} scroll={false} className="btn-ghost h-9 w-9 p-0" aria-label="Close"><X size={18} /></Link>
          <h2 id="intro-title" className="text-[16px] font-bold">{t(locale, "introModal.title")}</h2>
          <span className="w-9" />
        </div>

        <div className="px-5 py-4">
          <div className="flex items-center justify-center gap-3 py-2">
            <UserAvatar name={me.name} seed={me.handle} size={44} />
            <span className="h-px w-6 bg-line-strong" />
            {draft ? <UserAvatar name={draft.connector.name} seed={draft.connector.handle} size={36} /> : <span className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-dashed border-line-strong text-faint"><Handshake size={16} /></span>}
            <span className="h-px w-6 bg-line-strong" />
            <UserAvatar name={target.name} seed={target.handle} size={44} />
          </div>
          <p className="text-center text-[15px]">
            {t(locale, "introModal.to")} <b>{target.name}</b>
            {target.isDemo && <DemoBadge locale={locale} className="ml-1.5 align-middle" />}
          </p>
          <p className="text-center text-sm text-faint">{[target.headline, target.orgName].filter(Boolean).join(" @ ")}</p>

          {error && <p className="mt-4 rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}

          {!draft ? (
            mutual.length === 0 ? (
              <p className="mt-6 rounded-2xl border border-line bg-raised p-4 text-sm text-muted">{t(locale, "introModal.noMutual")}</p>
            ) : (
              <form action={draftIntroAction} className="mt-5 space-y-4">
                <input type="hidden" name="targetId" value={target.id} />
                <input type="hidden" name="locale" value={locale} />
                <fieldset>
                  <legend className="label">{t(locale, "introModal.via")}</legend>
                  <div className="space-y-2">
                    {mutual.map((m, i) => (
                      <label key={m.id} className="flex cursor-pointer items-center gap-3 rounded-2xl border border-line p-3 transition hover:border-line-strong has-[:checked]:border-accent has-[:checked]:bg-accent-soft">
                        <input type="radio" name="connectorId" value={m.id} defaultChecked={i === 0} className="accent-[var(--color-accent)]" />
                        <UserAvatar name={m.name} seed={m.handle} size={36} />
                        <span className="min-w-0">
                          <span className="flex items-center gap-1.5 text-[14px] font-semibold">{m.name} {m.isDemo && <DemoBadge locale={locale} />}</span>
                          <span className="block truncate text-xs text-faint">{[m.headline, m.orgName].filter(Boolean).join(" @ ")}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                </fieldset>
                <label className="block">
                  <span className="label">{t(locale, "introModal.reason")}</span>
                  <textarea name="reason" rows={2} required maxLength={300} className="input" placeholder={t(locale, "introModal.reasonPlaceholder")} />
                </label>
                <DraftPendingSkeleton label={t(locale, "introModal.drafting")} />
                <SubmitButton className="btn-primary w-full">
                  <Wand2 size={16} /> {t(locale, "introModal.draft")}
                </SubmitButton>
              </form>
            )
          ) : (
            <form action={sendIntroAction} className="mt-5 space-y-3">
              <input type="hidden" name="introId" value={draft.id} />
              <div className="flex items-center justify-between">
                <span className="label mb-0">{t(locale, "introModal.message").replace("{name}", draft.connector.name.split(" ")[0])}</span>
                <span className="inline-flex items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-medium text-violet-200">
                  <Sparkles size={11} /> {t(locale, "introModal.aiDrafted")} · {draft.provider}
                </span>
              </div>
              <textarea name="message" rows={9} defaultValue={draft.message} className="input text-[14px] leading-relaxed" />
              <p className="text-xs text-faint">{provider === "mock" ? t(locale, "introModal.mockNote") : t(locale, "introModal.reviewNote")}</p>
              <div className="flex gap-2">
                <Link href={`${close}?intro=1`} scroll={false} className="btn-secondary flex-1">{t(locale, "introModal.back")}</Link>
                <SubmitButton className="btn-primary flex-1">{t(locale, "introModal.send").replace("{name}", draft.connector.name.split(" ")[0])}</SubmitButton>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
