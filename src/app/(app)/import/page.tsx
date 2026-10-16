import Link from "next/link";
import { Check, ChevronRight, FileUp, Hash, ShieldCheck, Sparkles, UserPlus, Wallet, X as XIcon } from "lucide-react";
import { dismissSuggestionsAction, followSuggestionsAction, importFarcasterAction, importWalletAction, importXAction } from "@/app/import-actions";
import { UserAvatar } from "@/components/avatar";
import { Columns, PageHeader } from "@/components/layout";
import { SubmitButton } from "@/components/submit-button";
import { getLocale, requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { t, type Locale, type MessageKey } from "@/lib/i18n";
import { parseReasons, type SuggestionReason } from "@/lib/importers/suggestions";
import { STARTER_PACKS, getPack } from "@/lib/importers/wallet";
import { avatarUrl } from "@/lib/media";
import { shortAddress } from "@/lib/mera/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Bring your network" };

type Search = { ran?: string; followed?: string; dismissed?: string; fcError?: string; xError?: string; walletError?: string };

function FarcasterMark({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden fill="currentColor">
      <path d="M5 3h14v18h-2.6v-7.6a4.4 4.4 0 0 0-8.8 0V21H5z" />
    </svg>
  );
}
function XMark({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden fill="currentColor">
      <path d="M17.8 3h3.1l-6.8 7.7L22 21h-6.2l-4.9-6.3L5.3 21H2.2l7.3-8.3L2 3h6.4l4.4 5.8zm-1.1 16.2h1.7L7.4 4.7H5.6z" />
    </svg>
  );
}

const card = "glass p-4";
const iconWrap = "inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-accent-soft text-accent-ink";

function reasonLabel(r: SuggestionReason, locale: Locale): string {
  if (r.code === "fc_follow") return t(locale, "import.reason.fc").replace("{who}", r.detail ? `@${r.detail}` : "");
  if (r.code === "x_follow") return t(locale, "import.reason.x").replace("{who}", /^\d+$/.test(r.detail) ? "" : `@${r.detail}`);
  const pack = getPack(r.detail);
  const name = pack ? pack.label[locale] : r.detail;
  return t(locale, r.code === "wallet_pack" ? "import.reason.pack" : "import.reason.packChannel").replace("{pack}", name);
}

function RunSummary({ run, locale }: { run: { found: number; matched: number; createdAt: Date } | undefined; locale: Locale }) {
  if (!run) return null;
  return (
    <p className="mt-3 flex items-center gap-1.5 rounded-xl bg-white/70 px-3 py-2 text-[12.5px] text-muted">
      <Check size={13} className="text-success" />
      {t(locale, "import.lastRun").replace("{found}", String(run.found)).replace("{matched}", String(run.matched))}
    </p>
  );
}

function ErrorNote({ code, locale }: { code?: string; locale: Locale }) {
  if (!code) return null;
  const key = `import.error.${code}` as MessageKey;
  const known = ["username", "need_wallet", "not_found", "not_found_wallet", "unavailable", "empty", "too_large", "unreadable", "rate_limited"].includes(code);
  return <p role="alert" className="mt-3 rounded-xl bg-danger/10 px-3 py-2 text-[13px] text-danger">{t(locale, known ? key : "import.error.unavailable")}</p>;
}

export default async function ImportPage({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await requireUser();
  const locale = await getLocale();
  const sp = await searchParams;
  const hasWallet = user.walletVerified && !!user.walletAddress;
  const [suggestions, runs, packChecks] = await Promise.all([
    prisma.importSuggestion.findMany({
      where: { userId: user.id, status: "pending" },
      include: {
        targetUser: { select: { id: true, name: true, handle: true, headline: true, orgName: true, avatarKey: true } },
        channel: { select: { slug: true, name: true, description: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 200,
    }),
    prisma.importRun.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 30 }),
    prisma.walletPackCheck.findMany({ where: { userId: user.id, member: true } }),
  ]);
  const lastRun = (source: string) => runs.find((r) => r.source === source);
  const held = new Set(packChecks.map((p) => p.packId));
  const people = suggestions.filter((s) => s.targetUser);
  const channels = suggestions.filter((s) => s.channel);

  return (
    <Columns>
      <PageHeader title={t(locale, "import.title")} subtitle={t(locale, "import.subtitle")} back="/more" />
      <div className="space-y-4 px-4 py-5">
        <p className="px-1 text-[14.5px] leading-relaxed text-muted">{t(locale, "import.intro")}</p>

        {(sp.followed || sp.dismissed) && (
          <div className="rounded-2xl bg-accent-soft px-4 py-3 text-[14px] font-medium text-accent-ink" data-testid="import-done">
            <p className="flex items-center gap-2">
              <Check size={16} />
              {sp.followed ? t(locale, "import.followedN").replace("{n}", sp.followed) : t(locale, "import.dismissedN").replace("{n}", sp.dismissed ?? "0")}
            </p>
            {sp.followed && (
              <Link href="/sync" className="mt-1.5 inline-flex items-center gap-1 pl-6 text-[13px] font-semibold underline-offset-2 hover:underline">
                {t(locale, "import.signNext")} <ChevronRight size={14} />
              </Link>
            )}
          </div>
        )}

        {/* Farcaster */}
        <section id="farcaster" className={card} data-testid="import-farcaster">
          <div className="flex items-start gap-3">
            <span className={iconWrap}><FarcasterMark /></span>
            <div className="min-w-0 flex-1">
              <h2 className="text-[16px] font-semibold tracking-tight">{t(locale, "import.fc.title")}</h2>
              <p className="mt-0.5 text-[13.5px] text-muted">{t(locale, "import.fc.body")}</p>
            </div>
          </div>
          {user.farcasterFid && (
            <div className="mt-3 flex items-center gap-2 rounded-xl border border-line bg-white/80 px-3 py-2 text-[13px]">
              <FarcasterMark size={14} />
              <span className="font-semibold">@{user.farcasterUsername || user.farcasterFid}</span>
              <span className="text-faint">fid {user.farcasterFid}</span>
              <span className={`ml-auto inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11.5px] font-semibold ${user.farcasterVerified ? "bg-accent-soft text-accent-ink" : "bg-raised text-muted"}`}>
                {user.farcasterVerified ? <ShieldCheck size={12} /> : null}
                {t(locale, user.farcasterVerified ? "import.fc.verified" : "import.fc.unverified")}
              </span>
            </div>
          )}
          {user.farcasterFid && !user.farcasterVerified && <p className="mt-2 text-[12.5px] text-faint">{t(locale, "import.fc.verifyHint")}</p>}
          <form action={importFarcasterAction} className="mt-3 flex gap-2">
            <input name="username" className="input h-10 flex-1 py-1.5" placeholder={t(locale, "import.fc.placeholder")} aria-label={t(locale, "import.fc.placeholder")} autoComplete="off" />
            <SubmitButton className="btn-primary h-10 shrink-0 text-[13px]">{t(locale, "import.fc.cta")}</SubmitButton>
          </form>
          <p className="mt-2 text-[12px] text-faint">{t(locale, hasWallet ? "import.fc.walletHint" : "import.fc.noWalletHint")}</p>
          <ErrorNote code={sp.fcError} locale={locale} />
          <RunSummary run={lastRun("farcaster")} locale={locale} />
        </section>

        {/* X */}
        <section id="x" className={card} data-testid="import-x">
          <div className="flex items-start gap-3">
            <span className={iconWrap}><XMark /></span>
            <div className="min-w-0 flex-1">
              <h2 className="text-[16px] font-semibold tracking-tight">{t(locale, "import.x.title")}</h2>
              <p className="mt-0.5 text-[13.5px] text-muted">{t(locale, "import.x.body")}</p>
            </div>
          </div>
          <form action={importXAction} className="mt-3 space-y-2">
            <label className="flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl border border-dashed border-lilac bg-white/60 px-3.5 py-3 text-[13.5px] text-muted transition hover:bg-white">
              <FileUp size={18} className="shrink-0 text-accent" />
              <span className="min-w-0 flex-1">{t(locale, "import.x.pick")}</span>
              <input type="file" name="files" multiple accept=".js,.csv,.txt,text/csv,text/plain,application/javascript" className="w-full min-w-0 text-[12px] file:mr-2 file:rounded-full file:border-0 file:bg-accent-soft file:px-3 file:py-1 file:text-[12px] file:font-semibold file:text-accent-ink" />
            </label>
            <div className="flex items-center justify-between gap-3">
              <p className="text-[12px] text-faint">{t(locale, "import.x.hint")}</p>
              <SubmitButton className="btn-primary h-10 shrink-0 text-[13px]">{t(locale, "import.x.cta")}</SubmitButton>
            </div>
          </form>
          <ErrorNote code={sp.xError} locale={locale} />
          <RunSummary run={lastRun("x")} locale={locale} />
        </section>

        {/* Wallet */}
        <section id="wallet" className={card} data-testid="import-wallet">
          <div className="flex items-start gap-3">
            <span className={iconWrap}><Wallet size={18} /></span>
            <div className="min-w-0 flex-1">
              <h2 className="text-[16px] font-semibold tracking-tight">{t(locale, "import.wallet.title")}</h2>
              <p className="mt-0.5 text-[13.5px] text-muted">{t(locale, "import.wallet.body")}</p>
            </div>
          </div>
          <ul className="mt-3 flex flex-wrap gap-1.5">
            {STARTER_PACKS.map((p) => (
              <li key={p.id} className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[12px] font-medium ${held.has(p.id) ? "border-accent bg-accent-soft text-accent-ink" : "border-line bg-white/70 text-muted"}`}>
                {held.has(p.id) && <Check size={12} />}
                <span className="text-faint">{p.app}</span> {p.label[locale]}
              </li>
            ))}
          </ul>
          {hasWallet ? (
            <form action={importWalletAction} className="mt-3 flex items-center justify-between gap-3">
              <p className="min-w-0 text-[12px] text-faint">
                {t(locale, "import.wallet.readOnly")} <span className="font-mono">{shortAddress(user.walletAddress!)}</span>
              </p>
              <SubmitButton className="btn-primary h-10 shrink-0 text-[13px]">{t(locale, "import.wallet.cta")}</SubmitButton>
            </form>
          ) : (
            <p className="mt-3 rounded-xl bg-raised px-3 py-2 text-[13px] text-muted">
              {t(locale, "import.wallet.needWallet")} <Link href={`/u/${user.handle}`} className="font-semibold text-accent">{t(locale, "import.wallet.linkNow")}</Link>
            </p>
          )}
          <ErrorNote code={sp.walletError} locale={locale} />
          <RunSummary run={lastRun("wallet")} locale={locale} />
        </section>

        {/* Suggestions */}
        <section id="suggestions" className="pt-2" data-testid="import-suggestions">
          <div className="mb-3 flex items-baseline justify-between px-1">
            <h2 className="flex items-center gap-1.5 text-[17px] font-semibold tracking-tight">
              <Sparkles size={16} className="text-accent" /> {t(locale, "import.suggestions")}
            </h2>
            {suggestions.length > 0 && <span className="text-[13px] font-semibold text-accent-ink">{suggestions.length}</span>}
          </div>
          {suggestions.length === 0 ? (
            <div className="glass px-5 py-8 text-center">
              <p className="font-semibold">{t(locale, "import.noneTitle")}</p>
              <p className="mx-auto mt-1 max-w-sm text-[13.5px] text-muted">{t(locale, sp.ran ? "import.noneAfterRun" : "import.noneBody")}</p>
            </div>
          ) : (
            <form action={followSuggestionsAction} className="glass overflow-clip p-1.5">
              <p className="px-3 pb-1 pt-2 text-[12.5px] text-faint">{t(locale, "import.confirmHint")}</p>
              <ul className="divide-y divide-line/70">
                {people.map((s) => {
                  const u = s.targetUser!;
                  return (
                    <li key={s.id}>
                      <label className="flex cursor-pointer items-center gap-3 px-3 py-3">
                        <UserAvatar name={u.name} seed={u.handle} src={avatarUrl(u.avatarKey)} size={42} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[15px] font-semibold">{u.name}</span>
                          <span className="block truncate text-[12.5px] text-faint">{[u.headline, u.orgName].filter(Boolean).join(" · ") || `@${u.handle}`}</span>
                          <span className="mt-1 flex flex-wrap gap-1">
                            {parseReasons(s.reasons).map((r, i) => (
                              <span key={i} className="inline-flex items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 text-[11.5px] font-medium text-accent-ink">
                                {r.source === "farcaster" ? <FarcasterMark size={10} /> : r.source === "x" ? <XMark size={10} /> : <Wallet size={10} />}
                                {reasonLabel(r, locale)}
                              </span>
                            ))}
                          </span>
                        </span>
                        <input type="checkbox" name="ids" value={s.id} defaultChecked className="h-5 w-5 shrink-0 accent-[#7c3aed]" aria-label={u.name} />
                      </label>
                    </li>
                  );
                })}
                {channels.map((s) => (
                  <li key={s.id}>
                    <label className="flex cursor-pointer items-center gap-3 px-3 py-3">
                      <span className="inline-flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-2xl bg-accent-soft text-accent"><Hash size={20} /></span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[15px] font-semibold">/{s.channel!.slug}</span>
                        <span className="block truncate text-[12.5px] text-faint">{s.channel!.description}</span>
                        <span className="mt-1 flex flex-wrap gap-1">
                          {parseReasons(s.reasons).map((r, i) => (
                            <span key={i} className="inline-flex items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 text-[11.5px] font-medium text-accent-ink">
                              <Wallet size={10} /> {reasonLabel(r, locale)}
                            </span>
                          ))}
                        </span>
                      </span>
                      <input type="checkbox" name="ids" value={s.id} defaultChecked className="h-5 w-5 shrink-0 accent-[#7c3aed]" aria-label={s.channel!.slug} />
                    </label>
                  </li>
                ))}
              </ul>
              <div className="sticky-actions -mx-1.5 -mb-1.5 flex gap-2 rounded-b-[26px] border-t border-line/70 p-2.5 px-4" data-testid="import-actions">
                <button className="btn-primary h-11 flex-1"><UserPlus size={16} /> {t(locale, "import.followSelected")}</button>
                <button formAction={dismissSuggestionsAction} className="btn-secondary h-11"><XIcon size={16} /> {t(locale, "import.dismiss")}</button>
              </div>
            </form>
          )}
        </section>
      </div>
    </Columns>
  );
}
