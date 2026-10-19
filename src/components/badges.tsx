import { BadgeCheck, BriefcaseBusiness, IdCard, Mail, Rocket, Search, Sparkles, Wallet } from "lucide-react";
import { t, type Locale } from "@/lib/i18n";
import type { PostKind } from "@/lib/posts";
import { VerifiedOnMonad } from "./wallet-badge";

export function DemoBadge({ locale, className = "" }: { locale: Locale; className?: string }) {
  return (
    <span
      title={t(locale, "demo.tooltip")}
      className={`inline-flex items-center rounded-md border border-amber-300 bg-amber-50 px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide text-amber-800 ${className}`}
    >
      {t(locale, "demo.badge")}
    </span>
  );
}

const KIND_ICON: Record<PostKind, typeof Search> = {
  looking_for_partner: Search,
  launch: Rocket,
  hiring: BriefcaseBusiness,
  insight: Sparkles,
};

export function PostKindChip({ kind, locale }: { kind: string; locale: Locale }) {
  if (!(kind in KIND_ICON)) return null;
  const Icon = KIND_ICON[kind as PostKind];
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-medium text-accent-ink">
      <Icon size={11} strokeWidth={2.4} />
      {t(locale, `kind.${kind as PostKind}`)}
    </span>
  );
}


/** Small inline check shown next to names when any proof is verified. */
export function VerifiedTick({ verified }: { verified: boolean }) {
  return verified ? <BadgeCheck size={16} className="shrink-0 text-accent" aria-label="Verified" /> : null;
}

export function ProofBadges({
  user,
  locale,
  showWallet = true,
}: {
  /** walletAddress may be left out where it is not shown (public pages for visitors, showWallet false). */
  user: { workEmailVerified: boolean; linkedinVerified: boolean; walletVerified: boolean; walletAddress?: string | null };
  locale: Locale;
  /** false where the Verified on Monad badge is already shown prominently. */
  showWallet?: boolean;
}) {
  const walletOk = user.walletVerified && (!!user.walletAddress || !showWallet);
  const items = [
    { key: "email", icon: Mail, label: t(locale, "proof.workEmail"), ok: user.workEmailVerified },
    { key: "linkedin", icon: IdCard, label: "LinkedIn", ok: user.linkedinVerified },
    ...(walletOk ? [] : [{ key: "wallet", icon: Wallet, label: t(locale, "wallet.mera"), ok: false }]),
  ];
  return (
    <ul className="flex flex-wrap items-center gap-1.5">
      {walletOk && showWallet && (
        <li>
          <VerifiedOnMonad user={{ walletVerified: user.walletVerified, walletAddress: user.walletAddress ?? null }} locale={locale} size="sm" />
        </li>
      )}
      {items.map(({ key, icon: Icon, label, ok }) => (
        <li
          key={key}
          title={ok ? t(locale, "proof.verified") : t(locale, "proof.unverifiedHint")}
          className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${
            ok ? "border-accent/40 bg-accent-soft text-accent-ink" : "border-dashed border-line-strong text-faint"
          }`}
        >
          <Icon size={13} />
          {label}
          <span className={ok ? "text-accent" : ""}>· {ok ? t(locale, "proof.verified") : t(locale, "proof.unverified")}</span>
        </li>
      ))}
    </ul>
  );
}
