import { ShieldCheck } from "lucide-react";
import { t, type Locale } from "@/lib/i18n";
import { shortAddress } from "@/lib/mera/format";

/**
 * "Verified on Monad" — shown only when the profile's Mera wallet was linked
 * through a server-verified passkey signature (walletVerified + address).
 */
export function VerifiedOnMonad({
  user,
  locale,
  size = "md",
}: {
  user: { walletVerified: boolean; walletAddress: string | null };
  locale: Locale;
  size?: "sm" | "md";
}) {
  if (!user.walletVerified || !user.walletAddress) return null;
  const sm = size === "sm";
  return (
    <span
      title={`${t(locale, "wallet.verifiedHint")} ${user.walletAddress}`}
      className={`inline-flex items-center gap-1.5 rounded-full border border-lilac bg-gradient-to-r from-accent-soft to-white font-semibold text-accent-ink shadow-[0_4px_14px_-8px_rgb(124_58_237/0.55)] ${
        sm ? "px-2 py-0.5 text-[11px]" : "py-1 pl-1 pr-3 text-[13px]"
      }`}
    >
      <span className={`inline-flex items-center justify-center rounded-full bg-accent text-white ${sm ? "h-4 w-4" : "h-6 w-6"}`}>
        <ShieldCheck size={sm ? 11 : 14} strokeWidth={2.4} />
      </span>
      {t(locale, "wallet.verifiedOnMonad")}
      <span className="font-mono font-medium text-accent/80" aria-label={user.walletAddress}>
        · {shortAddress(user.walletAddress)}
      </span>
    </span>
  );
}
