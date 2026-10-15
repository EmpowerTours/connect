import Link from "next/link";
import { BadgeCheck, Clock, Fingerprint, ShieldCheck } from "lucide-react";
import { claimOrgAction, withdrawClaimAction } from "@/app/claim-actions";
import { SubmitButton } from "@/components/submit-button";
import { t, type Locale } from "@/lib/i18n";

const ERRORS = ["wallet_required", "already_pending", "already_member", "title_long", "evidence_url", "note_long"] as const;
type ClaimErr = (typeof ERRORS)[number];

/** "I work here": claim verified membership of an org (reviewed by an admin). */
export function ClaimPanel({
  org,
  myClaim,
  user,
  locale,
  sent,
  error,
}: {
  org: { id: string; slug: string; name: string };
  myClaim: { id: string; status: string; title: string } | null;
  user: { walletVerified: boolean; walletAddress: string | null };
  locale: Locale;
  sent?: boolean;
  error?: string;
}) {
  const box = "mx-4 my-4 rounded-[22px] border p-4";
  if (myClaim?.status === "approved") {
    return (
      <div className={`${box} border-lilac bg-accent-soft/50`}>
        <p className="flex items-center gap-2 text-[14px] font-semibold text-accent-ink"><BadgeCheck size={17} /> {t(locale, "claims.youAreMember").replace("{org}", org.name)}</p>
      </div>
    );
  }
  if (myClaim?.status === "pending") {
    return (
      <div className={`${box} border-amber-200 bg-amber-50/70`}>
        <p className="flex items-center gap-2 text-[14px] font-semibold text-amber-900"><Clock size={16} /> {t(locale, "claims.pending")}</p>
        <p className="mt-1 text-[13px] text-amber-900/80">{t(locale, "claims.pendingBody")}</p>
        {sent && <p className="mt-2 text-[13px] font-medium text-amber-900">{t(locale, "claims.sent")}</p>}
        <form action={withdrawClaimAction} className="mt-3">
          <input type="hidden" name="claimId" value={myClaim.id} />
          <SubmitButton className="btn-secondary h-9 text-[13px]">{t(locale, "claims.withdraw")}</SubmitButton>
        </form>
      </div>
    );
  }
  if (!user.walletVerified || !user.walletAddress) {
    return (
      <div className={`${box} border-dashed border-lilac bg-white/60`}>
        <p className="flex items-center gap-2 text-[14px] font-semibold"><Fingerprint size={16} className="text-accent" /> {t(locale, "claims.workHere")}</p>
        <p className="mt-1 text-[13px] text-muted">{t(locale, "claims.needWallet")}</p>
        <Link href="/profile#wallet" className="btn-secondary mt-3 h-9 text-[13px]">{t(locale, "wallet.link")}</Link>
      </div>
    );
  }
  return (
    <details className={`${box} group border-lilac bg-white/70`} open={!!error}>
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
        <span>
          <span className="flex items-center gap-2 text-[14px] font-semibold"><ShieldCheck size={16} className="text-accent" /> {t(locale, "claims.workHere")}</span>
          <span className="mt-0.5 block text-[13px] text-muted">{t(locale, "claims.intro")}</span>
        </span>
        <span className="btn-pill shrink-0 group-open:hidden">{t(locale, "claims.claim")}</span>
      </summary>
      {error && (ERRORS as readonly string[]).includes(error) && <p className="mt-3 rounded-xl bg-danger/10 p-2.5 text-sm text-danger">{t(locale, `claims.err.${error as ClaimErr}`)}</p>}
      <form action={claimOrgAction} className="mt-4 space-y-3">
        <input type="hidden" name="orgId" value={org.id} />
        <input type="hidden" name="back" value={`/orgs/${org.slug}?tab=people`} />
        <label className="block">
          <span className="label">{t(locale, "claims.title")}</span>
          <input name="title" maxLength={100} className="input" placeholder={t(locale, "claims.titlePh")} />
        </label>
        <label className="block">
          <span className="label">{t(locale, "claims.evidence")}</span>
          <input name="evidenceUrl" maxLength={300} className="input" placeholder="linkedin.com/in/…" />
        </label>
        <label className="block">
          <span className="label">{t(locale, "claims.note")}</span>
          <textarea name="note" rows={2} maxLength={500} className="input" placeholder={t(locale, "claims.notePh")} />
        </label>
        <p className="text-[12px] text-faint">{t(locale, "claims.reviewNote")}</p>
        <SubmitButton className="btn-primary h-11 w-full">{t(locale, "claims.submit")}</SubmitButton>
      </form>
    </details>
  );
}
