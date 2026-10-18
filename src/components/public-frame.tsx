import Link from "next/link";
import { APP_NAME } from "@/lib/brand";
import { t, type Locale } from "@/lib/i18n";
import { JoinBar, SignInLink } from "./join-links";
import { LocaleToggle, LogoMark } from "./shell";

/** Signed-out frame for public pages: slim header with sign-in, content column, sign-up bar. */
export function PublicFrame({ locale, children }: { locale: Locale; children: React.ReactNode }) {
  return (
    <>
      <header className="sticky top-0 z-40 border-b border-white/70 bg-white/70 backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-[1200px] items-center justify-between px-4 md:px-6">
          <Link href="/" className="flex items-center gap-2.5 text-[17px] font-semibold tracking-tight">
            <LogoMark size={28} />
            {APP_NAME}
          </Link>
          <div className="flex items-center gap-1.5">
            <LocaleToggle locale={locale} />
            <SignInLink label={t(locale, "public.signIn")} className="btn-secondary h-9 px-4 text-[13.5px]" />
          </div>
        </div>
      </header>
      <div className="pb-36 md:pb-28">{children}</div>
      <JoinBar title={t(locale, "public.joinTitle")} body={t(locale, "public.joinBody")} cta={t(locale, "public.joinCta")} />
    </>
  );
}
